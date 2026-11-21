export function assertEduConnectDatabaseTarget(appUrlRaw:string,migrationUrlRaw:string,expectedRef:string,expectedDatabase='postgres'){
  if(!/^[a-z0-9]{20}$/.test(expectedRef))throw new Error('EDUCONNECT_DATABASE_PROJECT_REF must be the verified 20-character project reference');
  const appUrl=new URL(appUrlRaw),migrationUrl=new URL(migrationUrlRaw);
  const identifies=(url:URL)=>url.hostname.includes(expectedRef)||decodeURIComponent(url.username).includes(expectedRef);
  if(!identifies(appUrl)||!identifies(migrationUrl)||appUrl.pathname!==migrationUrl.pathname||decodeURIComponent(appUrl.pathname.slice(1))!==expectedDatabase){
    throw new Error('Database identity guard failed: both URLs must identify the configured EduConnect project and database');
  }
  return {appUrl,migrationUrl};
}
