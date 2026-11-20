import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { initializeApp, getApps } from '@firebase/app';
import { browserLocalPersistence, createUserWithEmailAndPassword, getAuth, GoogleAuthProvider, onAuthStateChanged, sendEmailVerification, sendPasswordResetEmail, setPersistence, signInWithEmailAndPassword, signInWithPopup, signOut, type User } from '@firebase/auth';

const config={apiKey:import.meta.env.VITE_FIREBASE_API_KEY,authDomain:import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,projectId:import.meta.env.VITE_FIREBASE_PROJECT_ID,appId:import.meta.env.VITE_FIREBASE_APP_ID,messagingSenderId:import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID};
export const firebaseConfigured=Boolean(config.apiKey&&config.authDomain&&config.projectId&&config.appId);
export const firebaseAuth=firebaseConfigured?getAuth(getApps()[0]??initializeApp(config)):null;
if(firebaseAuth) void setPersistence(firebaseAuth,browserLocalPersistence);
export type FirebasePrincipal=User;
export async function firebaseIdToken():Promise<string|null>{return firebaseAuth?.currentUser?firebaseAuth.currentUser.getIdToken():null;}
export async function firebasePasswordSignIn(email:string,password:string){if(!firebaseAuth)throw new Error('Firebase Authentication is not configured');return (await signInWithEmailAndPassword(firebaseAuth,email,password)).user;}
export async function firebaseCreatePasswordAccount(email:string,password:string){if(!firebaseAuth)throw new Error('Firebase Authentication is not configured');const user=(await createUserWithEmailAndPassword(firebaseAuth,email,password)).user;await sendEmailVerification(user);await signOut(firebaseAuth);return user;}
export async function firebaseGoogleSignIn(){if(!firebaseAuth)throw new Error('Firebase Authentication is not configured');const provider=new GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});const result=await signInWithPopup(firebaseAuth,provider);return {user:result.user,googleIdToken:GoogleAuthProvider.credentialFromResult(result)?.idToken};}
export async function firebaseLogout(){if(firebaseAuth)await signOut(firebaseAuth);}
export async function firebaseResetPassword(email:string){if(!firebaseAuth)throw new Error('Firebase Authentication is not configured');await sendPasswordResetEmail(firebaseAuth,email);}
export async function firebaseResendVerification(){if(firebaseAuth?.currentUser&&!firebaseAuth.currentUser.emailVerified)await sendEmailVerification(firebaseAuth.currentUser);}

type AuthContextValue={principal:FirebasePrincipal|null;configured:boolean;ready:boolean};
const AuthContext=createContext<AuthContextValue>({principal:null,configured:false,ready:false});
export function FirebaseAuthProvider({children}:{children:ReactNode}){
  const [principal,setPrincipal]=useState<FirebasePrincipal|null>(firebaseAuth?.currentUser??null),[ready,setReady]=useState(!firebaseAuth);
  useEffect(()=>firebaseAuth?onAuthStateChanged(firebaseAuth,user=>{setPrincipal(user);setReady(true);}):undefined,[]);
  const value=useMemo(()=>({principal,configured:firebaseConfigured,ready}),[principal,ready]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useFirebaseAuth(){return useContext(AuthContext);}
