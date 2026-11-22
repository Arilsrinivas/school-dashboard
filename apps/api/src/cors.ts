export function isAllowedCorsOrigin(origin:string,configuredOrigin:string,vercelUrl:string|undefined,isProduction:boolean):boolean{
  if(origin===configuredOrigin.replace(/\/$/,''))return true;
  if(vercelUrl&&origin===`https://${vercelUrl}`)return true;
  return !isProduction&&(origin.startsWith('http://localhost:')||origin.startsWith('http://127.0.0.1:'));
}
