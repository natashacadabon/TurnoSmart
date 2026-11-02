/** Selector unico compartido por el cliente HTTP y las comprobaciones de build.
 * Next recibe los valores mediante accesos literales a process.env en api.ts.
 * @param {string | undefined} useAzure
 * @param {string | undefined} renderUrl
 * @param {string | undefined} azureUrl
 */
export function selectBackendUrl(useAzure, renderUrl, azureUrl) {
  if (useAzure !== undefined && useAzure !== 'false' && useAzure !== 'true')
    throw new Error('Configuracion publica invalida: NEXT_PUBLIC_USE_AZURE');
  return ((useAzure === 'true' ? azureUrl : renderUrl) ?? '').replace(/\/$/, '');
}
