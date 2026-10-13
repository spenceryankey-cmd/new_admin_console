import { ServiceUnavailableException } from '@nestjs/common'
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import { JwtTokenVerifier } from './token.verifier'

const URL_ = 'https://abc.supabase.co'
const ISS = `${URL_}/auth/v1`

type Pair = Awaited<ReturnType<typeof generateKeyPair>>
let good: Pair, other: Pair, goodJwk: JWK, verifier: JwtTokenVerifier

beforeAll(async () => {
  good = await generateKeyPair('ES256')
  other = await generateKeyPair('ES256')
  goodJwk = { ...(await exportJWK(good.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' }
  verifier = new JwtTokenVerifier(URL_, createLocalJWKSet({ keys: [goodJwk] }))
})

const sign = (claims: Record<string, unknown>, o: { key?: Pair; kid?: string; iss?: string; aud?: string; exp?: string | number } = {}) =>
  new SignJWT({ role: 'authenticated', ...claims })
    .setProtectedHeader({ alg: 'ES256', kid: o.kid ?? 'k1' })
    .setSubject((claims.sub as string | undefined) ?? 'user-1')
    .setIssuer(o.iss ?? ISS)
    .setAudience(o.aud ?? 'authenticated')
    .setIssuedAt()
    .setExpirationTime(o.exp ?? '1h')
    .sign((o.key ?? good).privateKey)

describe('JwtTokenVerifier', () => {
  it('accepts a good token and reads the user and how they signed in', async () => {
    expect(await verifier.verify(await sign({ aal: 'aal2' }))).toEqual({ userId: 'user-1', aal: 'aal2' })
    expect(await verifier.verify(await sign({ aal: 'aal1' }))).toEqual({ userId: 'user-1', aal: 'aal1' })
  })

  it('treats a missing or odd assurance level as the weaker one', async () => {
    expect(await verifier.verify(await sign({}))).toEqual({ userId: 'user-1', aal: 'aal1' })
    expect(await verifier.verify(await sign({ aal: 'aal3' }))).toEqual({ userId: 'user-1', aal: 'aal1' })
  })

  it('refuses an expired token', async () => {
    expect(await verifier.verify(await sign({}, { exp: Math.floor(Date.now() / 1000) - 60 }))).toBeNull()
  })

  it('refuses a token signed by someone else, even if it names the right key', async () => {
    expect(await verifier.verify(await sign({}, { key: other }))).toBeNull()
  })

  it('refuses a token for another audience or another project', async () => {
    expect(await verifier.verify(await sign({}, { aud: 'something-else' }))).toBeNull()
    expect(await verifier.verify(await sign({}, { iss: 'https://evil.supabase.co/auth/v1' }))).toBeNull()
  })

  it('refuses the anon key and any token that is not a signed in user', async () => {
    expect(await verifier.verify(await sign({ role: 'anon' }))).toBeNull()
    expect(await verifier.verify(await sign({ role: 'service_role' }))).toBeNull()
  })

  it('refuses a token with no subject', async () => {
    const t = await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'ES256', kid: 'k1' }).setIssuer(ISS).setAudience('authenticated').setExpirationTime('1h').sign(good.privateKey)
    expect(await verifier.verify(t)).toBeNull()
  })

  it('refuses a token that names a key we do not know (until the key set is refreshed)', async () => {
    expect(await verifier.verify(await sign({}, { kid: 'rotated' }))).toBeNull()
  })

  it('refuses an unsigned token and one using a shared secret algorithm', async () => {
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'u', aud: 'authenticated', iss: ISS, role: 'authenticated', exp: 9999999999 })).toString('base64url')}.`
    expect(await verifier.verify(none)).toBeNull()
    const hs = await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'HS256', kid: 'k1' }).setSubject('u').setIssuer(ISS).setAudience('authenticated').setExpirationTime('1h').sign(new TextEncoder().encode('x'.repeat(32)))
    expect(await verifier.verify(hs)).toBeNull()
  })

  it('refuses garbage', async () => {
    expect(await verifier.verify('not a token')).toBeNull()
    expect(await verifier.verify('')).toBeNull()
  })

  it('accepts a key that appears after a rotation once the key set knows it', async () => {
    const next = await generateKeyPair('ES256')
    const nextJwk = { ...(await exportJWK(next.publicKey)), kid: 'k2', alg: 'ES256', use: 'sig' }
    const v = new JwtTokenVerifier(URL_, createLocalJWKSet({ keys: [goodJwk, nextJwk] }))
    expect(await v.verify(await sign({}, { key: next, kid: 'k2' }))).toEqual({ userId: 'user-1', aal: 'aal1' })
    expect(await v.verify(await sign({}, { key: good, kid: 'k1' }))).toEqual({ userId: 'user-1', aal: 'aal1' })
  })

  it('refuses the request, rather than skipping the check, when the keys cannot be fetched', async () => {
    const broken = new JwtTokenVerifier(URL_, (async () => {
      throw new Error('network down')
    }) as never)
    await expect(broken.verify(await sign({}))).rejects.toBeInstanceOf(ServiceUnavailableException)
  })
})
