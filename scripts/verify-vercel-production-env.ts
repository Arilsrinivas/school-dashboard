import { validateProductionEnvironment } from '../apps/api/src/config.js';

if(process.env.VERCEL==='1'&&process.env.VERCEL_ENV==='production'){
  validateProductionEnvironment({...process.env,NODE_ENV:'production'});
  const expected:Record<string,string>={
    VITE_FIREBASE_AUTH_DOMAIN:'educonnect-44f2b.firebaseapp.com',
    VITE_FIREBASE_PROJECT_ID:'educonnect-44f2b',
    VITE_FIREBASE_APP_ID:'1:680544077722:web:81875b1be669b7fcd11c23',
    VITE_FIREBASE_MESSAGING_SENDER_ID:'680544077722'
  };
  for(const key of ['VITE_FIREBASE_API_KEY',...Object.keys(expected)])if(!process.env[key]?.trim())throw new Error(`${key} must be configured for the EduConnect production frontend`);
  for(const [key,value] of Object.entries(expected))if(process.env[key]!==value)throw new Error(`${key} must match the registered EduConnect Firebase Web App`);
  if(process.env.VITE_API_URL?.trim())throw new Error('VITE_API_URL must be empty for the same-origin EduConnect Vercel deployment');
}
