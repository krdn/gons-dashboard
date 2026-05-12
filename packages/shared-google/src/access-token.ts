import { z } from "zod";
import { GoogleApiError, OAuthExpiredError, TransientError } from "./errors";

const ResponseSchema = z.object({
  accessToken: z.string().min(1),
  expiresAt: z.string().datetime(),
});

export interface FetchAccessTokenOptions {
  mediatorUrl: string;
  bearer: string;
  /** Inject for tests; defaults to global fetch. */
  fetcher?: typeof fetch;
}

export interface AccessTokenResult {
  accessToken: string;
  expiresAt: string;
}

export async function fetchAccessToken(
  opts: FetchAccessTokenOptions,
): Promise<AccessTokenResult> {
  const { mediatorUrl, bearer, fetcher = fetch } = opts;
  let response: Response;
  try {
    response = await fetcher(mediatorUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${bearer}`,
        Accept: "application/json",
      },
    });
  } catch (err) {
    throw new TransientError(
      `Mediator unreachable: ${err instanceof Error ? err.message : String(err)}`,
      0,
    );
  }

  if (response.status === 410) {
    throw new OAuthExpiredError();
  }
  if (response.status === 401 || response.status === 403) {
    throw new GoogleApiError(
      `Mediator auth failed (${response.status})`,
      response.status,
    );
  }
  if (response.status >= 500 || response.status === 429) {
    throw new TransientError(
      `Mediator transient failure (${response.status})`,
      response.status,
    );
  }
  if (!response.ok) {
    throw new GoogleApiError(
      `Mediator unexpected ${response.status}`,
      response.status,
    );
  }

  const body = await response.json();
  const parsed = ResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new GoogleApiError(
      `Mediator response shape invalid: ${parsed.error.message}`,
      500,
    );
  }
  return parsed.data;
}
