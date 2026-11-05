import type { LogLine } from '../api/types'
import { signingService } from './signingService'

/** Verify the mock webshell's canonical signature for one log line. */
export function verifyLogLineSignature(
  requestId: string,
  line: LogLine,
  signingKey: string,
): boolean {
  const { webshellSignature, ...unsignedLine } = line
  return signingService.verifyWebshellSignature(
    { requestId, ...unsignedLine },
    webshellSignature,
    signingKey,
  )
}
