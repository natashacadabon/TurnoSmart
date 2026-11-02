/** Diagnosticos por lista permitida: nunca se serializa el error original. */
export class SeedError extends Error {
  override name = 'SeedError';
}
export type SeedStage =
  | 'configuration'
  | 'fixtures'
  | 'prisma_connection'
  | 'migrations'
  | 'supabase_auth'
  | 'user_creation'
  | 'auth_login'
  | 'auth_session_cleanup'
  | 'profiles'
  | 'businesses'
  | 'customers'
  | 'services'
  | 'availability'
  | 'appointments'
  | 'appointment_events'
  | 'risk_scores'
  | 'reminders'
  | 'data_validation'
  | 'summary'
  | 'transaction_begin'
  | 'transaction_commit'
  | 'disconnect';

export interface SeedDiagnostic {
  stage: SeedStage;
  type: string;
  code?: string;
  status?: number;
  databaseCode?: string;
  causeCode?: string;
  message: string;
}

const messages: Record<string, string> = {
  P1000:
    'Prisma: autenticacion de PostgreSQL rechazada. Revisar credenciales del destino sin publicarlas.',
  P1001:
    'Prisma: no se pudo alcanzar PostgreSQL. Revisar conectividad, DNS, IPv4/IPv6 y disponibilidad del destino.',
  P1002: 'Prisma: timeout al conectar con PostgreSQL.',
  P1003: 'Prisma: la base solicitada no existe.',
  P1008: 'Prisma: timeout de una operacion.',
  P1010: 'Prisma: el usuario de PostgreSQL no tiene acceso suficiente.',
  P1011: 'Prisma: fallo al establecer TLS.',
  P1012: 'Prisma: configuracion o schema invalidos.',
  P1013:
    'Prisma: formato de conexion invalido. Revisar codificacion de caracteres sin publicar la URL.',
  P1014: 'Prisma: falta una tabla o estructura requerida; revisar migraciones.',
  P1017: 'Prisma: PostgreSQL cerro la conexion.',
  P2000: 'Un valor supera la longitud admitida por la base.',
  P2002:
    'Conflicto de unicidad. Puede existir un registro con el mismo nombre/email y otro ID; no se fusionan ni sobrescriben filas ajenas.',
  P2003:
    'Una clave foranea fue rechazada. Revisar relaciones de negocio, perfil, servicio y turno.',
  P2004:
    'Una restriccion de PostgreSQL rechazo los datos; revisar las restricciones de la etapa indicada.',
  P2010: 'PostgreSQL rechazo una consulta SQL. Revisar el codigo SQL seguro y la etapa indicada.',
  P2011: 'Una columna obligatoria recibio null.',
  P2014: 'La operacion viola una relacion requerida.',
  P2021: 'Falta una tabla requerida. Revisar las migraciones aplicadas al destino.',
  P2022:
    'Falta una columna requerida. Revisar consistencia entre migraciones, base y Prisma Client.',
  P2023: 'La base devolvio datos incompatibles con el modelo Prisma.',
  P2024: 'Se agoto el tiempo para obtener una conexion del pool.',
  P2025: 'No se encontro un registro requerido por la operacion.',
  P2028: 'Fallo la transaccion o se excedio su timeout.',
  P2034:
    'Conflicto concurrente o deadlock; la transaccion se revirtio. Reintentar solo despues de revisar la concurrencia.',
  P2037: 'PostgreSQL rechazo conexiones por limite de capacidad.',
  invalid_credentials:
    'Auth rechazo las credenciales. Si la cuenta ya existia, usar su password original; el seed no la cambia.',
  email_exists: 'Auth informa que el email ya existe. No se resetea su password.',
  user_already_exists: 'Auth informa que el usuario ya existe. No se resetea su password.',
  email_not_confirmed: 'La cuenta de Auth existente no esta confirmada.',
  email_address_invalid: 'Auth rechazo el formato o dominio del email de prueba.',
  weak_password: 'La password no cumple la politica del proyecto Auth. Ajustarla sin publicarla.',
  user_banned: 'Auth informa que la cuenta esta bloqueada.',
  bad_jwt: 'Auth rechazo el token o la credencial del proyecto.',
  no_authorization: 'Falta autorizacion para la API de Auth.',
  not_admin: 'La clave usada no tiene permisos de Auth Admin.',
  over_request_rate_limit: 'Auth limito temporalmente las solicitudes.',
  over_email_send_rate_limit: 'Auth limito temporalmente operaciones de email.',
  signup_disabled: 'La politica del proyecto no permite esta operacion de alta.',
  session_not_found: 'Auth no encontro la sesion requerida.',
  unexpected_failure: 'Auth reporto un error interno del proveedor.',
  ENOTFOUND: 'No se pudo resolver el destino mediante DNS.',
  EAI_AGAIN: 'Fallo temporal de resolucion DNS.',
  ECONNREFUSED: 'El destino rechazo la conexion.',
  ECONNRESET: 'El destino interrumpio la conexion.',
  ETIMEDOUT: 'La conexion excedio el tiempo de espera.',
  EHOSTUNREACH: 'No hay ruta de red al destino.',
  ENETUNREACH: 'La red del destino no es accesible.',
  CERT_HAS_EXPIRED: 'El certificado TLS esta vencido.',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'No se pudo verificar la cadena TLS.',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'El destino presento un certificado TLS autofirmado.',
  ERR_TLS_CERT_ALTNAME_INVALID: 'El certificado TLS no coincide con el destino.',
};
const sqlMessages: Record<string, string> = {
  '23505': 'PostgreSQL: conflicto de unicidad; no se sobrescriben registros ajenos.',
  '23503': 'PostgreSQL: relacion o clave foranea invalida.',
  '23502': 'PostgreSQL: falta un valor obligatorio.',
  '23514': 'PostgreSQL: una restriccion CHECK rechazo los datos.',
  '42501':
    'PostgreSQL: permisos insuficientes. La clave Auth Admin no otorga permisos al usuario de la conexion Prisma.',
  '42P01': 'PostgreSQL: falta una tabla requerida. Revisar migraciones antes de cargar datos.',
  '42703': 'PostgreSQL: falta una columna requerida. Revisar migraciones y Prisma Client.',
  '28P01': 'PostgreSQL: password de conexion rechazada.',
  '40001': 'PostgreSQL: conflicto de serializacion; la transaccion se revirtio.',
  '40P01': 'PostgreSQL: deadlock; la transaccion se revirtio.',
  '42P05':
    'PostgreSQL: conflicto de prepared statements; revisar el modo de pooler y la configuracion Prisma.',
  '26000': 'PostgreSQL: prepared statement no disponible; revisar pooler y sesion.',
  '53300': 'PostgreSQL: limite de conexiones alcanzado.',
};
const controlledMessages: Record<string, string> = {
  'Seed bloqueado en produccion.': 'SEED_PRODUCTION_BLOCKED',
  'Fuera de loopback: Cloud requiere ALLOW_REMOTE_SEED=true.': 'SEED_REMOTE_BLOCKED',
  'Project Ref remoto fuera de la lista autorizada.': 'SEED_PROJECT_NOT_ALLOWED',
  'Cloud requiere DIRECT_URL explicita para verificar el proyecto.': 'SEED_DIRECT_URL_REQUIRED',
  'DATABASE_URL, DIRECT_URL y SUPABASE_URL deben corresponder al mismo proyecto autorizado.':
    'SEED_PROJECT_MISMATCH',
  'Falta confirmacion explicita: SEED_CONFIRM_REMOTE=seed:<Project Ref autorizado>.':
    'SEED_CONFIRMATION_REQUIRED',
  'SUPABASE_URL: solo se admite la URL HTTPS oficial del proyecto.': 'SEED_API_URL_INVALID',
  'DIRECT_URL requiere conexion directa o pooler de sesion (5432).': 'SEED_DIRECT_URL_INVALID',
  'Falta SUPABASE_SECRET_KEY o SUPABASE_SERVICE_ROLE_KEY (solo backend).':
    'SEED_ADMIN_KEY_REQUIRED',
  'Falta SUPABASE_ANON_KEY para verificar login.': 'SEED_PUBLIC_KEY_REQUIRED',
  'Defini SEED_ADMIN_PASSWORD con al menos 10 caracteres.': 'SEED_PASSWORD_REQUIRED',
  'La clave administrativa debe ser privilegiada, no publishable.': 'SEED_ADMIN_KEY_INVALID',
  'Un usuario existente tiene otro perfil/negocio/rol; seed cancelado.': 'SEED_PROFILE_CONFLICT',
  'Un ID reservado del seed pertenece a otro negocio/configuracion.': 'SEED_BUSINESS_CONFLICT',
  'ID de cliente ocupado por otro negocio.': 'SEED_CUSTOMER_CONFLICT',
  'ID de servicio ocupado por otro negocio.': 'SEED_SERVICE_CONFLICT',
  'ID de disponibilidad ocupado por otro negocio.': 'SEED_AVAILABILITY_CONFLICT',
  'ID de turno ocupado por otro negocio.': 'SEED_APPOINTMENT_CONFLICT',
  'ID de evento ocupado por otro turno.': 'SEED_EVENT_CONFLICT',
  'ID de riesgo ocupado por otro turno.': 'SEED_RISK_CONFLICT',
  'ID de recordatorio ocupado por otro turno.': 'SEED_REMINDER_CONFLICT',
  'Hay turnos activos superpuestos; seed cancelado sin modificar datos de negocio.': 'SEED_OVERLAP',
  'Relacion o duracion de seed invalida.': 'SEED_RELATION_INVALID',
  'Turno de seed fuera de disponibilidad.': 'SEED_AVAILABILITY_INVALID',
  'Una cuenta de prueba existente no esta confirmada; revisala en Auth del destino.':
    'SEED_EMAIL_NOT_CONFIRMED',
  'No se pudo iniciar sesion: si la cuenta ya existia, usa su password original. El seed no la cambia.':
    'SEED_LOGIN_FAILED',
  'El token del administrador no pudo verificarse.': 'SEED_TOKEN_INVALID',
  'No se pudo verificar el perfil OWNER del administrador.': 'SEED_OWNER_INVALID',
  'Auth no devolvio un usuario creado.': 'SEED_AUTH_USER_MISSING',
};
// Mensajes construidos solo con nombres de variables conocidos, nunca con sus valores.
for (const key of ['DATABASE_URL', 'DIRECT_URL', 'SUPABASE_URL']) {
  for (const text of [
    `Falta ${key}.`,
    `${key} no es una URL valida.`,
    `${key}: protocolo no permitido.`,
    `${key}: usuario no valido.`,
    `${key}: host/usuario Supabase no autorizado.`,
    `${key}: base o puerto no permitido.`,
    `${key}: parametro de conexion no permitido.`,
    `${key}: solo se admite schema public.`,
  ])
    controlledMessages[text] = 'SEED_CONFIG_INVALID';
}
const types = new Set([
  'SeedError',
  'Error',
  'TypeError',
  'PrismaClientKnownRequestError',
  'PrismaClientInitializationError',
  'PrismaClientValidationError',
  'PrismaClientUnknownRequestError',
  'PrismaClientRustPanicError',
  'AuthError',
  'AuthApiError',
  'AuthRetryableFetchError',
  'AuthUnknownError',
  'AuthSessionMissingError',
  'AuthInvalidCredentialsError',
]);
const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
const own = (obj: Record<string, string>, key: unknown): key is string =>
  typeof key === 'string' && Object.hasOwn(obj, key);

export class SeedFailure extends Error {
  constructor(readonly diagnostic: SeedDiagnostic) {
    super(diagnostic.message);
    this.name = 'SeedFailure';
  }
}

function genericMessage(stage: SeedStage, type: string, status?: number) {
  if (status === 401) return 'Auth/HTTP rechazo la credencial del proyecto o token.';
  if (status === 403) return 'Auth/HTTP rechazo la operacion por permisos insuficientes.';
  if (status === 429) return 'Auth/HTTP limito temporalmente las solicitudes.';
  if (status)
    return 'Auth/HTTP rechazo la solicitud. Revisar la etapa y las politicas del proyecto.';
  if (stage === 'configuration')
    return 'Configuracion del seed rechazada. Revisar variables, proyecto permitido y confirmacion; no se inicio la carga.';
  if (type === 'PrismaClientValidationError')
    return 'Los argumentos Prisma no coinciden con el cliente generado. Revisar tipos, schema y generacion del cliente.';
  return 'Fallo sin detalles publicables. Revisar la etapa indicada; no se imprimen mensajes arbitrarios ni datos del error original.';
}

export function seedFailure(stage: SeedStage, error: unknown): SeedFailure {
  if (error instanceof SeedFailure) return error; // Conservar la etapa interna, no la transaccion exterior.
  const value = record(error);
  const type =
    typeof value.name === 'string' && types.has(value.name) ? value.name : 'UnknownError';
  const code = own(messages, value.code)
    ? value.code
    : own(messages, value.errorCode)
      ? value.errorCode
      : undefined;
  const status =
    typeof value.status === 'number' &&
    Number.isInteger(value.status) &&
    value.status >= 400 &&
    value.status <= 599
      ? value.status
      : undefined;
  const sqlCode = record(value.meta).code;
  const databaseCode = own(sqlMessages, sqlCode) ? sqlCode : undefined;
  let cause = value;
  let causeCode: string | undefined;
  for (let i = 0; i < 4; i++) {
    if (own(messages, cause.code) && /^[A-Z_]+$/.test(cause.code)) {
      causeCode = cause.code;
      break;
    }
    cause = record(cause.cause ?? cause.originalError);
  }
  // El texto proviene del catalogo, no del mensaje arbitrario del proveedor.
  const controlled = Object.entries(controlledMessages).find(([safe]) => safe === value.message);
  const message =
    controlled?.[0] ??
    sqlMessages[databaseCode ?? ''] ??
    messages[code ?? ''] ??
    messages[causeCode ?? ''] ??
    genericMessage(stage, type, status);
  return new SeedFailure({
    stage,
    type,
    ...(code ? { code } : controlled ? { code: controlled[1] } : {}),
    ...(status ? { status } : {}),
    ...(databaseCode ? { databaseCode } : {}),
    ...(causeCode ? { causeCode } : {}),
    message,
  });
}

export async function seedStep<T>(stage: SeedStage, action: () => T | Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw seedFailure(stage, error);
  }
}

export function reportSeedFailure(
  error: unknown,
  stage: SeedStage = 'configuration',
  event: 'seed_failed' | 'seed_cleanup_failed' = 'seed_failed',
) {
  console.error(JSON.stringify({ event, ...seedFailure(stage, error).diagnostic }));
}

/** El cierre no debe reemplazar la causa original si ambas operaciones fallan. */
export async function withSeedCleanup<T>(
  action: () => Promise<T>,
  cleanup: () => Promise<unknown>,
) {
  let failed = false;
  try {
    return await action();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      await seedStep('disconnect', cleanup);
    } catch (error) {
      if (!failed) throw error;
      reportSeedFailure(error, 'disconnect', 'seed_cleanup_failed');
    }
  }
}
