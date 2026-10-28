export function databasePermissionDenied({ status, json }) {
  return [401, 403].includes(status) && json?.code === "42501";
}

export function storagePermissionDenied({ status, json }) {
  return [400, 403].includes(status) && String(json?.statusCode) === "403" && json?.error === "Unauthorized";
}

export function hiddenRows(response, denied = databasePermissionDenied) {
  return denied(response) || (response.status === 200 && Array.isArray(response.json) && response.json.length === 0);
}
