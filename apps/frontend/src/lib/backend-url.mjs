/** Selector unico compartido por el cliente HTTP y las comprobaciones de build.
 * Next recibe los valores mediante accesos literales a process.env en api.ts.
 * @param {string | undefined} useAzure
 * @param {string | undefined} renderUrl
 * @param {string | undefined} azureUrl
 * @param {boolean} development
 * @param {string} developmentHost
 */
export function selectBackendUrl(
  useAzure,
  renderUrl,
  azureUrl,
  development = false,
  developmentHost = 'localhost',
) {
  // Mantiene el origen local fuera del bundle de produccion.
  if (development) return `http://${developmentHost}:4000`;
  if (useAzure !== undefined && useAzure !== 'false' && useAzure !== 'true')
    throw new Error('Configuracion publica invalida: NEXT_PUBLIC_USE_AZURE');
  return ((useAzure === 'true' ? azureUrl : renderUrl) ?? '').replace(/\/$/, '');
}
