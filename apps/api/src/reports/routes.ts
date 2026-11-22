import { Router, type Request } from 'express';
import { z } from 'zod';
import { tenantTransaction, type DbClient } from '../db/pool.js';
import { asyncRoute, fail } from '../http.js';
import { authenticate, requireSchoolPermission } from '../middleware/auth.js';
import PDFDocument from 'pdfkit';
import { strToU8, zipSync } from 'fflate';

export const reportsRouter = Router();
reportsRouter.use(authenticate);

const uuid = z.uuid();

function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  let str = String(val);
  // Defend against CSV injection (=, +, -, @, \t, \r)
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\n\r]/.test(str)) {
    str = `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function xmlEscape(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[char]!);
}

function columnName(index: number): string {
  let name = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  }
  return name;
}

function createXlsx(sheetName: string, rows: Record<string, unknown>[]): Uint8Array {
  const headers = rows.length ? Object.keys(rows[0]!) : [];
  const values = [headers, ...rows.map(row => headers.map(header => row[header]))];
  const worksheetRows = values.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const address = `${columnName(columnIndex)}${rowIndex + 1}`;
      if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${address}"><v>${value}</v></c>`;
      if (typeof value === 'boolean') return `<c r="${address}" t="b"><v>${value ? 1 : 0}</v></c>`;
      const text = xmlEscape(value instanceof Date ? value.toISOString() : value);
      return `<c r="${address}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');
  const safeSheetName = xmlEscape(sheetName.slice(0, 31));
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${safeSheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${worksheetRows}</sheetData></worksheet>`),
  };
  return zipSync(files, { level: 6 });
}

reportsRouter.get(
  '/reports/dashboard',
  requireSchoolPermission('reports:read', 'reports:class', 'dashboard:read'),
  asyncRoute(async (req, res) => {
    const schoolId = req.tenant!.id;

    const data = await tenantTransaction(schoolId, async client => {
      // Basic counts
      const counts = await client.query(
        `SELECT
          (SELECT count(*)::int FROM students WHERE school_id = $1 AND status = 'active') AS active_students,
          (SELECT count(*)::int FROM teachers WHERE school_id = $1 AND employment_status = 'active') AS active_teachers,
          (SELECT count(*)::int FROM parents WHERE school_id = $1) AS total_parents,
          (SELECT count(*)::int FROM classes WHERE school_id = $1) AS total_classes`,
        [schoolId]
      );

      // Attendance summary (last 30 days)
      const att = await client.query(
        `SELECT status, count(*)::int AS count
         FROM attendance
         WHERE school_id = $1 AND attendance_date >= CURRENT_DATE - 30
         GROUP BY status`,
        [schoolId]
      );

      // Fee metrics
      const fees = await client.query(
        `SELECT
          COALESCE(sum(sf.amount_due_minor), 0)::bigint AS total_due_minor,
          COALESCE((SELECT sum(p.amount_minor) FROM payments p WHERE p.school_id = $1), 0)::bigint AS total_paid_minor,
          COALESCE((SELECT sum(r.amount_minor) FROM payment_reversals r WHERE r.school_id = $1), 0)::bigint AS total_reversed_minor
         FROM student_fees sf
         WHERE sf.school_id = $1 AND sf.is_active`,
        [schoolId]
      );

      // Upcoming/Recent examinations
      const exams = await client.query(
        `SELECT id, name, exam_type, starts_on, ends_on, status, results_published_at
         FROM examinations
         WHERE school_id = $1
         ORDER BY starts_on DESC LIMIT 5`,
        [schoolId]
      );

      const feeRow = fees.rows[0];
      const netPaid = Number(feeRow?.total_paid_minor || 0) - Number(feeRow?.total_reversed_minor || 0);
      const totalDue = Number(feeRow?.total_due_minor || 0);
      const outstanding = Math.max(0, totalDue - netPaid);

      return {
        counts: counts.rows[0],
        attendanceSummary: att.rows,
        fees: {
          totalDueMinor: totalDue,
          netCollectedMinor: netPaid,
          outstandingMinor: outstanding,
        },
        recentExams: exams.rows,
      };
    });

    res.json(data);
  })
);

reportsRouter.get(
  '/reports/academics',
  requireSchoolPermission('reports:read', 'reports:class'),
  asyncRoute(async (req, res) => {
    const schoolId = req.tenant!.id;
    const examId = typeof req.query.examId === 'string' ? uuid.parse(req.query.examId) : null;
    const classId = typeof req.query.classId === 'string' ? uuid.parse(req.query.classId) : null;

    const data = await tenantTransaction(schoolId, async client => {
      let query = `
        SELECT e.id AS examination_id, e.name AS examination_name, c.id AS class_id, c.name AS class_name,
               s.name AS subject_name, es.max_marks,
               count(r.id)::int AS total_submissions,
               round(avg(r.marks), 2)::numeric AS average_marks,
               max(r.marks)::numeric AS highest_marks,
               min(r.marks)::numeric AS lowest_marks
        FROM examinations e
        JOIN examination_subjects es ON es.school_id = e.school_id AND es.examination_id = e.id
        JOIN classes c ON c.school_id = es.school_id AND c.id = es.class_id
        JOIN subjects s ON s.school_id = es.school_id AND s.id = es.subject_id
        LEFT JOIN examination_results r ON r.school_id = es.school_id AND r.examination_subject_id = es.id AND r.marks IS NOT NULL
        WHERE e.school_id = $1
      `;
      const params: unknown[] = [schoolId];
      if (examId) {
        query += ` AND e.id = $${params.length + 1}`;
        params.push(examId);
      }
      if (classId) {
        query += ` AND c.id = $${params.length + 1}`;
        params.push(classId);
      }
      query += ` GROUP BY e.id, e.name, c.id, c.name, s.name, es.max_marks ORDER BY e.name, c.name, s.name`;

      const rows = await client.query(query, params);
      return rows.rows;
    });

    res.json({ items: data });
  })
);

reportsRouter.get(
  '/reports/attendance',
  requireSchoolPermission('reports:read', 'reports:class'),
  asyncRoute(async (req, res) => {
    const schoolId = req.tenant!.id;
    const fromDate = typeof req.query.from === 'string' ? req.query.from : new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const toDate = typeof req.query.to === 'string' ? req.query.to : new Date().toISOString().slice(0, 10);

    const data = await tenantTransaction(schoolId, async client => {
      const rows = await client.query(
        `SELECT a.attendance_date, c.name AS class_name, sec.name AS section_name,
                count(*)::int AS total_records,
                count(*) FILTER (WHERE a.status = 'present')::int AS present_count,
                count(*) FILTER (WHERE a.status = 'absent')::int AS absent_count,
                count(*) FILTER (WHERE a.status = 'late')::int AS late_count,
                count(*) FILTER (WHERE a.status = 'excused')::int AS excused_count
         FROM attendance a
         JOIN classes c ON c.school_id = a.school_id AND c.id = a.class_id
         LEFT JOIN sections sec ON sec.school_id = a.school_id AND sec.id = a.section_id
         WHERE a.school_id = $1 AND a.attendance_date BETWEEN $2::date AND $3::date
         GROUP BY a.attendance_date, c.name, sec.name
         ORDER BY a.attendance_date DESC, c.name, sec.name`,
        [schoolId, fromDate, toDate]
      );
      return rows.rows;
    });

    res.json({ from: fromDate, to: toDate, items: data });
  })
);

reportsRouter.get(
  '/reports/export',
  requireSchoolPermission('reports:read'),
  asyncRoute(async (req, res) => {
    const schoolId = req.tenant!.id;
    const type = z.enum(['students', 'fees', 'attendance', 'examinations']).parse(req.query.type);

    const rows = await tenantTransaction(schoolId, async client => {
      if (type === 'students') {
        const q = await client.query(
          `SELECT st.admission_number, st.first_name, st.last_name, st.status, c.name AS class_name, sec.name AS section_name, y.name AS academic_year
           FROM students st
           LEFT JOIN student_enrollments se ON se.school_id = st.school_id AND se.student_id = st.id AND se.status = 'active'
           LEFT JOIN classes c ON c.school_id = se.school_id AND c.id = se.class_id
           LEFT JOIN sections sec ON sec.school_id = se.school_id AND sec.id = se.section_id
           LEFT JOIN academic_years y ON y.school_id = se.school_id AND y.id = se.academic_year_id
           WHERE st.school_id = $1 ORDER BY st.admission_number`,
          [schoolId]
        );
        return q.rows;
      } else if (type === 'fees') {
        const q = await client.query(
          `SELECT st.admission_number, st.first_name || ' ' || st.last_name AS student_name,
                  fc.name AS fee_category, fs.amount_minor / 100.0 AS structure_amount,
                  sf.amount_due_minor / 100.0 AS amount_due,
                  COALESCE((SELECT sum(p.amount_minor) FROM payments p WHERE p.school_id = sf.school_id AND p.student_fee_id = sf.id), 0) / 100.0 AS paid,
                  sf.due_on
           FROM student_fees sf
           JOIN students st ON st.school_id = sf.school_id AND st.id = sf.student_id
           JOIN fee_structures fs ON fs.school_id = sf.school_id AND fs.id = sf.fee_structure_id
           JOIN fee_categories fc ON fc.school_id = fs.school_id AND fc.id = fs.category_id
           WHERE sf.school_id = $1 AND sf.is_active ORDER BY st.admission_number`,
          [schoolId]
        );
        return q.rows;
      } else if (type === 'attendance') {
        const q = await client.query(
          `SELECT a.attendance_date, st.admission_number, st.first_name || ' ' || st.last_name AS student_name,
                  c.name AS class_name, a.status, a.reason
           FROM attendance a
           JOIN students st ON st.school_id = a.school_id AND st.id = a.student_id
           JOIN classes c ON c.school_id = a.school_id AND c.id = a.class_id
           WHERE a.school_id = $1 ORDER BY a.attendance_date DESC, st.admission_number LIMIT 1000`,
          [schoolId]
        );
        return q.rows;
      } else {
        const q = await client.query(
          `SELECT e.name AS examination, e.exam_type, c.name AS class_name, s.name AS subject_name,
                  st.admission_number, st.first_name || ' ' || st.last_name AS student_name,
                  r.marks, es.max_marks, r.grade
           FROM examination_results r
           JOIN examination_subjects es ON es.school_id=r.school_id AND es.id=r.examination_subject_id
           JOIN examinations e ON e.school_id=es.school_id AND e.id=es.examination_id
           JOIN classes c ON c.school_id=es.school_id AND c.id=es.class_id
           JOIN subjects s ON s.school_id=es.school_id AND s.id=es.subject_id
           JOIN students st ON st.school_id=r.school_id AND st.id=r.student_id
           WHERE r.school_id=$1 AND e.results_published_at IS NOT NULL
           ORDER BY e.starts_on DESC,c.name,st.admission_number,s.name LIMIT 10000`, [schoolId]);
        return q.rows;
      }
    });

    if (req.query.format === 'csv') {
      if (!rows.length) return res.send('No data');
      const headers = Object.keys(rows[0]!);
      const csv = [
        headers.join(','),
        ...rows.map(r => headers.map(h => escapeCsvCell((r as Record<string, unknown>)[h])).join(',')),
      ].join('\r\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${type}-report.csv"`);
      return res.send(csv);
    }

    if (req.query.format === 'xlsx') {
      const buffer = createXlsx(type, rows as Record<string, unknown>[]);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${type}-report.xlsx"`);
      return res.send(Buffer.from(buffer));
    }

    if (req.query.format === 'pdf') {
      const doc = new PDFDocument({ autoFirstPage: true, margin: 40, size: 'A4', layout: 'landscape' });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${type}-report.pdf"`);
      doc.pipe(res);
      doc.fontSize(18).text(`${type[0]!.toUpperCase()}${type.slice(1)} report`, { align: 'center' }).moveDown();
      if (!rows.length) doc.fontSize(10).text('No data');
      else {
        const headers = Object.keys(rows[0]!);
        doc.fontSize(7).text(headers.join('  |  '), { continued: false }).moveDown(0.4);
        for (const row of rows) {
          const line = headers.map(h => String((row as Record<string, unknown>)[h] ?? '').replace(/[\r\n]+/g, ' ')).join('  |  ');
          if (doc.y > 540) doc.addPage();
          doc.fontSize(6).text(line, { width: 760 });
        }
      }
      doc.end();
      return;
    }

    res.json({ items: rows });
  })
);
