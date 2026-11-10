/** Selector unico compartido por el cliente HTTP y las comprobaciones de build.
 * Next recibe los valores mediante accesos literales a process.env en api.ts.
 * @param {string | undefined} useAzure
 * @param {string | undefined} renderUrl
 * @param {string | undefined} azureUrl
 * @param {boolean} development
 * @param {string} developmentHost
 * @param {string | undefined} developmentUrl
 */
export function selectBackendUrl(
  useAzure,
  renderUrl,
  azureUrl,
  development = false,
  developmentHost = 'localhost',
  developmentUrl,
) {
  // Mantiene el origen local fuera del bundle de produccion.
  if (development) {
    if (developmentUrl === undefined) return `http://${developmentHost}:4000`;
    if (!/^http:\/\/(localhost|127\.0\.0\.1):\d{1,5}\/?$/.test(developmentUrl))
      throw new Error('NEXT_PUBLIC_API_URL de desarrollo debe apuntar al host local');
    return developmentUrl.replace(/\/$/, '');
  }
  if (useAzure !== undefined && useAzure !== 'false' && useAzure !== 'true')
    throw new Error('Configuracion publica invalida: NEXT_PUBLIC_USE_AZURE');
  return ((useAzure === 'true' ? azureUrl : renderUrl) ?? '').replace(/\/$/, '');
}
