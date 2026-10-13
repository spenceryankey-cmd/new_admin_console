import { ServiceUnavailableException } from '@nestjs/common'
import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { isAssuranceLevel, type AssuranceLevel } from '@beyondx/shared'

export type VerifiedToken = { userId: string; aal: AssuranceLevel }

export interface TokenVerifier {
  /** The signed in user and how they signed in, or null when the token is not acceptable. */
  verify(token: string): Promise<VerifiedToken | null>
}

export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER')

// The algorithms Supabase uses for its asymmetric signing keys. HS256 is left out on purpose: a shared
// secret would have to live in this service, and the public keys need no secret at all.
const ALGORITHMS = ['ES256', 'RS256', 'EdDSA']

/**
 * Checks a Supabase access token on this server: signature (against the project's public signing keys),
 * expiry, issuer and audience. No call to Supabase per request, and no secret needed.
 * If the public keys cannot be fetched the request is refused; there is no fallback that skips the check.
 */
export class JwtTokenVerifier implements TokenVerifier {
  private readonly issuer: string

  constructor(supabaseUrl: string, private readonly keys: JWTVerifyGetKey) {
    this.issuer = `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`
  }

  static fromUrl(supabaseUrl: string): JwtTokenVerifier {
    const base = supabaseUrl.replace(/\/+$/, '')
    const keys = createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`), {
      cooldownDuration: 30_000, // at most one refetch every 30 seconds when a token names an unknown key
      cacheMaxAge: 10 * 60_000,
      timeoutDuration: 5_000,
    })
    return new JwtTokenVerifier(base, keys)
  }

  async verify(token: string): Promise<VerifiedToken | null> {
    try {
      const { payload } = await jwtVerify(token, this.keys, {
        issuer: this.issuer,
        audience: 'authenticated',
        algorithms: ALGORITHMS,
        requiredClaims: ['sub', 'exp'],
      })
      if (payload.role !== 'authenticated' || typeof payload.sub !== 'string' || !payload.sub) return null
      return { userId: payload.sub, aal: isAssuranceLevel(payload.aal) ? payload.aal : 'aal1' }
    } catch (e) {
      // A bad token is a normal 401. Failing to reach the key set is our problem, not the caller's.
      if (e instanceof joseErrors.JWKSTimeout) {
        throw new ServiceUnavailableException('Could not check your sign in right now. Try again in a moment.')
      }
      if (e instanceof joseErrors.JOSEError) return null
      throw new ServiceUnavailableException('Could not check your sign in right now. Try again in a moment.')
    }
  }
}
