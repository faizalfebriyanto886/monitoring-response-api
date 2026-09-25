import dotenv from 'dotenv';
import { applicationDefault, cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

dotenv.config();

const parseServiceAccount = () => {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) return null;

  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
    return serviceAccount;
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT must contain valid JSON');
  }
};

const serviceAccount = parseServiceAccount();
const app = getApps().length
  ? getApp()
  : initializeApp({
      credential: serviceAccount ? cert(serviceAccount) : applicationDefault(),
      ...(process.env.FIREBASE_PROJECT_ID
        ? { projectId: process.env.FIREBASE_PROJECT_ID }
        : {}),
    });

export const db = getFirestore(app);
export const logsCollection = db.collection('api_logs');

export const initDb = async () => {
  // A lightweight read checks that Firestore credentials and connectivity work.
  await logsCollection.limit(1).get();
  console.log('Firestore connected successfully');
};
