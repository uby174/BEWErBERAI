import { requestAccessToken } from "./googleDriveService";

const DOCS_API_BASE = "https://docs.googleapis.com/v1/documents";

const assertOk = async (response: Response, context: string): Promise<void> => {
  if (response.ok) return;

  const message = await response.text();
  throw new Error(`${context} failed (${response.status}): ${message}`);
};

const authHeaders = (token: string): HeadersInit => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

export interface CreatedGoogleDoc {
  id: string;
  title: string;
  url: string;
}

export interface OptimizedDocWritebackResult {
  resume?: CreatedGoogleDoc;
  cover?: CreatedGoogleDoc;
}

export const createGoogleDoc = async (title: string): Promise<CreatedGoogleDoc> => {
  const token = await requestAccessToken();

  const response = await fetch(DOCS_API_BASE, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ title }),
  });

  await assertOk(response, "Google Docs create");
  const data = await response.json();

  return {
    id: data.documentId,
    title: data.title ?? title,
    url: `https://docs.google.com/document/d/${data.documentId}/edit`,
  };
};

export const writeTextToGoogleDoc = async (documentId: string, text: string): Promise<void> => {
  const token = await requestAccessToken();

  const response = await fetch(`${DOCS_API_BASE}/${documentId}:batchUpdate`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      requests: [
        {
          insertText: {
            location: { index: 1 },
            text: text.length > 0 ? text : " ",
          },
        },
      ],
    }),
  });

  await assertOk(response, "Google Docs batchUpdate");
};

export const createAndWriteGoogleDoc = async (title: string, text: string): Promise<CreatedGoogleDoc> => {
  const created = await createGoogleDoc(title);
  await writeTextToGoogleDoc(created.id, text);
  return created;
};

export const createOptimizedDocs = async ({
  resumeText,
  coverText,
  resumeTitle = "Optimized Resume",
  coverTitle = "Optimized Cover Letter",
}: {
  resumeText: string | null;
  coverText: string | null;
  resumeTitle?: string;
  coverTitle?: string;
}): Promise<OptimizedDocWritebackResult> => {
  const output: OptimizedDocWritebackResult = {};

  if (resumeText && resumeText.trim().length > 0) {
    output.resume = await createAndWriteGoogleDoc(resumeTitle, resumeText);
  }

  if (coverText && coverText.trim().length > 0) {
    output.cover = await createAndWriteGoogleDoc(coverTitle, coverText);
  }

  return output;
};
