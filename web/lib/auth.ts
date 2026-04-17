import { SignJWT, jwtVerify } from 'jose';

const encoder = new TextEncoder();

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET missing');
  }
  return encoder.encode(secret);
}

export type AuthPayload = {
  sub: string;
  username: string;
  email?: string;
  role: 'ADMIN' | 'USER';
};

export async function signAuthToken(payload: AuthPayload) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(getSecret());
}

export async function verifyAuthToken(token: string) {
  const { payload } = await jwtVerify(token, getSecret());
  return payload as unknown as AuthPayload;
}
