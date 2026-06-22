import { issueSignedToken, presignUrl } from "@vercel/blob";
import { Sandbox } from "@vercel/sandbox";

export const vercelCredentials = {
  teamId: process.env.VERCEL_TEAM_ID!,
  projectId: process.env.VERCEL_PROJECT_ID!,
  token: process.env.VERCEL_API_TOKEN!,
};

export async function createSandboxFromBlob(
  blobPath: string,
  opts: Parameters<typeof Sandbox.create>[0] = {},
): Promise<Sandbox> {
  const signedToken = await issueSignedToken({
    pathname: blobPath,
  });

  const { presignedUrl } = await presignUrl(signedToken, {
    pathname: blobPath,
    access: "private",
    operation: "get",
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

  return sandbox;
}
