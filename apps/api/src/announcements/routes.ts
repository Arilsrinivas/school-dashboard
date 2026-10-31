import { Router, type Request } from 'express';
import { z } from 'zod';
import { tenantTransaction, type DbClient } from '../db/pool.js';
import { asyncRoute, fail } from '../http.js';
import { authenticate, requireSchoolPermission } from '../middleware/auth.js';

export const announcementsRouter = Router();
announcementsRouter.use(authenticate);

const uuid = z.uuid();
const audienceSchema = z.object({
  type: z.enum(['school', 'role', 'class']),
  targetRoles: z.array(z.enum(['teacher', 'parent', 'student', 'school_admin'])).optional(),
  targetClassIds: z.array(uuid).optional(),
});

const createAnnouncementSchema = z.object({
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(5).max(10000),
  audience: audienceSchema.default({ type: 'school' }),
  publish: z.boolean().default(false),
  expiresAt: z.string().datetime({ offset: true }).optional().nullable(),
});

const updateAnnouncementSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  body: z.string().trim().min(5).max(10000).optional(),
  audience: audienceSchema.optional(),
  expiresAt: z.string().datetime({ offset: true }).optional().nullable(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
});

function has(req: Request, ...permissions: string[]) {
  return permissions.some(p => req.permissions?.includes(p));
}

async function actorMembership(client: DbClient, schoolId: string, userId: string) {
  const result = await client.query(
    'SELECT id, role FROM school_memberships WHERE school_id=$1 AND user_id=$2 AND is_active',
    [schoolId, userId]
  );
  if (!result.rows[0]) fail(403, 'Active school membership is required');
  return result.rows[0] as { id: string; role: string };
}

async function auditAnnouncement(
  client: DbClient,
  schoolId: string,
  actorId: string,
  announcementId: string,
  action: string,
  after: unknown,
  before?: unknown
) {
  await client.query(
    'INSERT INTO announcement_audit_history(school_id, announcement_id, actor_membership_id, action, before_state, after_state) VALUES($1, $2, $3, $4, $5::jsonb, $6::jsonb)',
    [schoolId, announcementId, actorId, action, before ? JSON.stringify(before) : null, JSON.stringify(after)]
  );
  await client.query(
    'INSERT INTO audit_logs(school_id, actor_membership_id, action, target_type, target_id, metadata) VALUES($1, $2, $3, $4, $5, $6::jsonb)',
    [schoolId, actorId, `announcement.${action}`, 'announcement', announcementId, JSON.stringify(after)]
  );
}

// Distribute in-app notifications to targeted users when an announcement is published
async function dispatchNotificationsForAnnouncement(
  client: DbClient,
  schoolId: string,
  announcementId: string,
  title: string,
  audience: z.infer<typeof audienceSchema>
) {
  let targetUserQuery = 'SELECT DISTINCT user_id FROM school_memberships WHERE school_id = $1 AND is_active';
  const params: unknown[] = [schoolId];

  if (audience.type === 'role' && audience.targetRoles?.length) {
    targetUserQuery += ' AND role = ANY($2::text[])';
    params.push(audience.targetRoles);
  } else if (audience.type === 'class' && audience.targetClassIds?.length) {
    targetUserQuery = `
      SELECT DISTINCT u.id AS user_id
      FROM users u
      WHERE u.id IN (
        -- Students enrolled in target classes
        SELECT st.user_id FROM students st
        JOIN student_enrollments se ON se.school_id = st.school_id AND se.student_id = st.id
        WHERE st.school_id = $1 AND se.class_id = ANY($2::uuid[]) AND se.status = 'active' AND st.user_id IS NOT NULL
        UNION
        -- Parents of students in target classes
        SELECT p.user_id FROM parents p
        JOIN student_parents sp ON sp.school_id = p.school_id AND sp.parent_id = p.id
        JOIN student_enrollments se ON se.school_id = sp.school_id AND se.student_id = sp.student_id
        WHERE p.school_id = $1 AND se.class_id = ANY($2::uuid[]) AND se.status = 'active'
        UNION
        -- Teachers assigned to target classes
        SELECT t.user_id FROM teachers t
        JOIN teacher_assignments ta ON ta.school_id = t.school_id AND ta.teacher_id = t.id
        JOIN class_subjects cs ON cs.school_id = ta.school_id AND cs.id = ta.class_subject_id
        WHERE t.school_id = $1 AND cs.class_id = ANY($2::uuid[]) AND t.employment_status = 'active'
      )
    `;
    params.push(audience.targetClassIds);
  }

  const users = await client.query(targetUserQuery, params);
  for (const row of users.rows) {
    await client.query(
      `INSERT INTO notifications (school_id, user_id, event_type, title, payload, delivered_at)
       VALUES ($1, $2, 'announcement', $3, $4::jsonb, now())`,
      [schoolId, row.user_id, title, JSON.stringify({ announcementId, title })]
    );
  }
}

// ----------------- ANNOUNCEMENTS ROUTES -----------------

announcementsRouter.get(
  '/announcements',
  requireSchoolPermission('announcements:read', 'announcements:manage'),
  asyncRoute(async (req, res) => {
    const schoolId = req.tenant!.id;
    const canManage = has(req, 'announcements:manage');
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const page = Math.max(1, Number(req.query.page) || 1);
    const offset = (page - 1) * limit;

    const data = await tenantTransaction(schoolId, async client => {
      const userMembership = await actorMembership(client, schoolId, req.identity!.id);
      let query = `
        SELECT a.id, a.title, a.body, a.audience, a.status, a.published_at, a.expires_at, a.created_at, a.updated_at,
               u.name AS author_name, r.name AS author_role
        FROM announcements a
        LEFT JOIN school_memberships m ON m.school_id = a.school_id AND m.id = a.author_membership_id
        LEFT JOIN users u ON u.id = m.user_id
        LEFT JOIN school_roles r ON r.school_id = m.school_id AND r.id = m.school_role_id
        WHERE a.school_id = $1
      `;
      const params: unknown[] = [schoolId];

      if (!canManage) {
        query += ` AND a.status = 'published' AND (a.expires_at IS NULL OR a.expires_at > now())`;
        // Role-based visibility filter
        query += ` AND (
          (a.audience->>'type') = 'school'
          OR ((a.audience->>'type') = 'role' AND (a.audience->'targetRoles')::jsonb ? $2)
          OR ((a.audience->>'type') = 'class')
        )`;
        params.push(userMembership.role);
      }

      query += ` ORDER BY a.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);

      const items = await client.query(query, params);
      const countRes = await client.query(
        `SELECT count(*)::int AS total FROM announcements a WHERE a.school_id = $1 ${
          !canManage ? "AND a.status = 'published' AND (a.expires_at IS NULL OR a.expires_at > now())" : ''
        }`,
        [schoolId]
      );

      return { items: items.rows, total: countRes.rows[0]?.total || 0, page, limit };
    });

    res.json(data);
  })
);

announcementsRouter.post(
  '/announcements',
  requireSchoolPermission('announcements:manage'),
  asyncRoute(async (req, res) => {
    const schoolId = req.tenant!.id;
    const input = createAnnouncementSchema.parse(req.body);

    const announcement = await tenantTransaction(schoolId, async client => {
      const actor = await actorMembership(client, schoolId, req.identity!.id);
      const status = input.publish ? 'published' : 'draft';
      const publishedAt = input.publish ? new Date().toISOString() : null;

      const created = await client.query(
        `INSERT INTO announcements (school_id, author_membership_id, title, body, audience, status, published_at, expires_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
         RETURNING id, title, body, audience, status, published_at, expires_at, created_at, updated_at`,
        [
          schoolId,
          actor.id,
          input.title,
          input.body,
          JSON.stringify(input.audience),
          status,
          publishedAt,
          input.expiresAt ?? null,
        ]
      );

      const row = created.rows[0];
      await auditAnnouncement(client, schoolId, actor.id, row.id, input.publish ? 'published' : 'created', row);

      if (input.publish) {
        await dispatchNotificationsForAnnouncement(client, schoolId, row.id, row.title, input.audience);
      }

      return row;
    });

    res.status(201).json({ announcement });
  })
);

announcementsRouter.patch(
  '/announcements/:id',
  requireSchoolPermission('announcements:manage'),
  asyncRoute(async (req, res) => {
    const schoolId = req.tenant!.id;
    const id = uuid.parse(req.params.id);
    const input = updateAnnouncementSchema.parse(req.body);

    const announcement = await tenantTransaction(schoolId, async client => {
      const actor = await actorMembership(client, schoolId, req.identity!.id);
      const existing = await client.query(
        'SELECT * FROM announcements WHERE school_id = $1 AND id = $2 FOR UPDATE',
        [schoolId, id]
      );
      if (!existing.rows[0]) fail(404, 'Announcement not found');
      const prev = existing.rows[0];

      const newTitle = input.title ?? prev.title;
      const newBody = input.body ?? prev.body;
      const newAudience = input.audience ? JSON.stringify(input.audience) : prev.audience;
      const newExpiresAt = input.expiresAt !== undefined ? input.expiresAt : prev.expires_at;
      const newStatus = input.status ?? prev.status;
      const wasPublished = prev.status !== 'published' && newStatus === 'published';
      const publishedAt = wasPublished ? new Date().toISOString() : prev.published_at;

      const updated = await client.query(
        `UPDATE announcements
         SET title = $3, body = $4, audience = $5::jsonb, expires_at = $6, status = $7, published_at = $8, updated_at = now()
         WHERE school_id = $1 AND id = $2
         RETURNING id, title, body, audience, status, published_at, expires_at, created_at, updated_at`,
        [schoolId, id, newTitle, newBody, newAudience, newExpiresAt, newStatus, publishedAt]
      );

      const row = updated.rows[0];
      await auditAnnouncement(client, schoolId, actor.id, id, 'updated', row, prev);

      if (wasPublished) {
        await dispatchNotificationsForAnnouncement(client, schoolId, id, row.title, row.audience);
      }

      return row;
    });

    res.json({ announcement });
  })
);

announcementsRouter.post(
  '/announcements/:id/publish',
  requireSchoolPermission('announcements:manage'),
  asyncRoute(async (req, res) => {
    const schoolId = req.tenant!.id;
    const id = uuid.parse(req.params.id);

    const announcement = await tenantTransaction(schoolId, async client => {
      const actor = await actorMembership(client, schoolId, req.identity!.id);
      const existing = await client.query(
        'SELECT * FROM announcements WHERE school_id = $1 AND id = $2 FOR UPDATE',
        [schoolId, id]
      );
      if (!existing.rows[0]) fail(404, 'Announcement not found');
      if (existing.rows[0].status === 'published') fail(409, 'Announcement is already published');

      const updated = await client.query(
        `UPDATE announcements
         SET status = 'published', published_at = now(), updated_at = now()
         WHERE school_id = $1 AND id = $2
         RETURNING id, title, body, audience, status, published_at, expires_at, created_at, updated_at`,
        [schoolId, id]
      );

      const row = updated.rows[0];
      await auditAnnouncement(client, schoolId, actor.id, id, 'published', row, existing.rows[0]);
      await dispatchNotificationsForAnnouncement(client, schoolId, id, row.title, row.audience);

      return row;
    });

    res.json({ announcement });
  })
);

// ----------------- NOTIFICATIONS ROUTES -----------------

announcementsRouter.get(
  '/notifications',
  requireSchoolPermission('announcements:read', 'dashboard:read'),
  asyncRoute(async (req, res) => {
    const schoolId = req.tenant!.id;
    const userId = req.identity!.id;
    const unreadOnly = req.query.unread === 'true';

    const data = await tenantTransaction(schoolId, async client => {
      let query = `
        SELECT id, event_type, title, payload, read_at, created_at
        FROM notifications
        WHERE school_id = $1 AND user_id = $2
      `;
      const params: unknown[] = [schoolId, userId];

      if (unreadOnly) {
        query += ' AND read_at IS NULL';
      }

      query += ' ORDER BY created_at DESC LIMIT 50';

      const items = await client.query(query, params);
      const unreadCount = await client.query(
        'SELECT count(*)::int AS count FROM notifications WHERE school_id = $1 AND user_id = $2 AND read_at IS NULL',
        [schoolId, userId]
      );

      return { items: items.rows, unreadCount: unreadCount.rows[0]?.count || 0 };
    });

    res.json(data);
  })
);

announcementsRouter.patch(
  '/notifications/:id/read',
  requireSchoolPermission('announcements:read', 'dashboard:read'),
  asyncRoute(async (req, res) => {
    const schoolId = req.tenant!.id;
    const userId = req.identity!.id;
    const id = uuid.parse(req.params.id);

    const updated = await tenantTransaction(schoolId, async client => {
      const res = await client.query(
        `UPDATE notifications SET read_at = now() WHERE school_id = $1 AND user_id = $2 AND id = $3 RETURNING id, read_at`,
        [schoolId, userId, id]
      );
      if (!res.rows[0]) fail(404, 'Notification not found');
      return res.rows[0];
    });

    res.json({ notification: updated });
  })
);

announcementsRouter.post(
  '/notifications/read-all',
  requireSchoolPermission('announcements:read', 'dashboard:read'),
  asyncRoute(async (req, res) => {
    const schoolId = req.tenant!.id;
    const userId = req.identity!.id;

    await tenantTransaction(schoolId, async client => {
      await client.query(
        `UPDATE notifications SET read_at = now() WHERE school_id = $1 AND user_id = $2 AND read_at IS NULL`,
        [schoolId, userId]
      );
    });

    res.json({ success: true });
  })
);
