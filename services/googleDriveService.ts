
/**
 * Note: For this to work in a production environment, 
 * you would need to provide a Client ID and API Key from Google Cloud Console.
 * This implementation handles the OAuth flow and file management.
 */

declare const gapi: any;
declare const google: any;

let tokenClient: any;
let accessToken: string | null = null;

const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';

const getGoogleClientId = (): string => {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();
  if (!clientId) {
    throw new Error(
      'Missing Google OAuth client id: set VITE_GOOGLE_CLIENT_ID in .env.local and restart the dev server.'
    );
  }
  return clientId;
};

const assertDriveResponse = async (response: Response, operation: string): Promise<void> => {
  if (response.ok) return;
  const message = await response.text();
  throw new Error(`${operation} failed (${response.status}): ${message}`);
};

export const initGoogleApi = () => {
  return new Promise<void>((resolve) => {
    const clientId = getGoogleClientId();

    gapi.load('client', async () => {
      await gapi.client.init({
        discoveryDocs: [DISCOVERY_DOC],
      });
      resolve();
    });

    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (response: any) => {
        if (response.error !== undefined) {
          throw response;
        }
        accessToken = response.access_token;
      },
    });
  });
};

export const requestAccessToken = () => {
  return new Promise<string>((resolve) => {
    tokenClient.callback = (resp: any) => {
      accessToken = resp.access_token;
      resolve(resp.access_token);
    };
    tokenClient.requestAccessToken({ prompt: 'consent' });
  });
};

export const uploadAndConvert = async (file: File) => {
  if (!accessToken) await requestAccessToken();

  const metadata = {
    name: file.name,
    mimeType: 'application/vnd.google-apps.document', // Convert to Google Doc
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', file);

  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  await assertDriveResponse(response, 'Drive uploadAndConvert');

  const data = await response.json();
  return { id: data.id, link: data.webViewLink };
};

export const downloadDocxFromDrive = async (fileId: string, filename: string) => {
  if (!accessToken) await requestAccessToken();

  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/vnd.openxmlformats-officedocument.wordprocessingml.document`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  await assertDriveResponse(response, 'Drive downloadDocxFromDrive');

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.docx`;
  a.click();
  window.URL.revokeObjectURL(url);
};
