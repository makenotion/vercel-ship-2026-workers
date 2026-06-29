import { issueSignedToken, presignUrl } from "@vercel/blob";
import { Sandbox } from "@vercel/sandbox";

export const vercelCredentials = {
  teamId: process.env.VERCEL_TEAM_ID!,
  projectId: process.env.VERCEL_PROJECT_ID!,
  token: process.env.VERCEL_API_TOKEN!,
};

export async function withSandbox<T>(
  blobKey: string,
  fn: (sandbox: Sandbox) => Promise<T>,
  opts: Parameters<typeof Sandbox.create>[0] = {},
): Promise<T> {
  const validUntil = Date.now() + 60 * 1000;
  const signedToken = await issueSignedToken({
    pathname: blobKey,
    validUntil,
  });

  const { presignedUrl } = await presignUrl(signedToken, {
    pathname: blobKey,
    access: "private",
    operation: "get",
    validUntil,
  });

  const sandbox = await Sandbox.create({
    ...vercelCredentials,
    persistent: false,
    runtime: "node26",
    timeout: 60 * 1000,
    ...opts,
    source: {
      type: "tarball",
      url: presignedUrl,
    },
  });

  try {
    return await fn(sandbox);
  } finally {
    await sandbox.delete();
  }
}
