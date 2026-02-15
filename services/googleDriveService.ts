
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

export const initGoogleApi = () => {
  return new Promise<void>((resolve) => {
    gapi.load('client', async () => {
      await gapi.client.init({
        discoveryDocs: [DISCOVERY_DOC],
      });
      resolve();
    });

    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: 'REPLACE_WITH_YOUR_CLIENT_ID', // User needs to provide this or use a proxy
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

  const data = await response.json();
  return { id: data.id, link: data.webViewLink };
};

export const downloadDocxFromDrive = async (fileId: string, filename: string) => {
  if (!accessToken) await requestAccessToken();

  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/vnd.openxmlformats-officedocument.wordprocessingml.document`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.docx`;
  a.click();
};
