import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isAllowedCorsOrigin} from './cors.js';

test('production CORS permits only the configured EduConnect origin and exact Vercel deployment',()=>{
  assert.equal(isAllowedCorsOrigin('https://educonnect.example','https://educonnect.example',undefined,true),true);
  assert.equal(isAllowedCorsOrigin('https://educonnect-preview-123.vercel.app','https://educonnect.example','educonnect-preview-123.vercel.app',true),true);
  assert.equal(isAllowedCorsOrigin('https://school-dashboard-nine-rho.vercel.app','https://educonnect.example','educonnect-preview-123.vercel.app',true),false);
  assert.equal(isAllowedCorsOrigin('https://another-project-arilsrinivas-projects.vercel.app','https://educonnect.example','educonnect-preview-123.vercel.app',true),false);
  assert.equal(isAllowedCorsOrigin('http://localhost:5173','https://educonnect.example',undefined,true),false);
  assert.equal(isAllowedCorsOrigin('http://localhost:5173','http://localhost:5173',undefined,false),true);
});
