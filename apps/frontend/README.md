# Frontend de TurnoSmart

Aplicación Next.js con App Router, React, Material UI y FullCalendar. Usa Supabase Auth para iniciar sesión y consume la API Express con contratos de `@turnosmart/shared`.

| Ruta                                                    | Funcionalidad                                                                                                                                  |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `/login`, `/register`, `/onboarding`                    | Inicio de sesión, registro público con verificación de correo y alta del negocio para una cuenta verificada.                                   |
| `/forgot-password`, `/reset-password`, `/auth/callback` | Recuperación de contraseña, primer acceso por invitación y enlaces de correo.                                                                  |
| `/admin`, `/sin-acceso`                                 | Entrada del ADMIN de la plataforma y aviso para cuentas sin acceso.                                                                            |
| `/`                                                     | Agenda de día, semana y mes en la zona del negocio, alta de turnos, indicadores diarios y evaluación de riesgo bajo demanda.                   |
| `/appointments/[id]`                                    | Detalle, notas, historial, acciones del personal, solicitudes de cambio y explicación con Gemini.                                              |
| `/customers`                                            | Búsqueda, alta y edición. La baja requiere OWNER y que el cliente carezca de turnos.                                                           |
| `/services`                                             | Servicios, franjas semanales y consulta de slots.                                                                                              |
| `/settings`                                             | Configuración del negocio y de sus notificaciones, con vistas previas de correo. Sólo OWNER edita.                                             |
| `/notifications`                                        | Historial interno, filtro de avisos sin leer y lecturas por usuario.                                                                           |
| `/turno/gestionar`                                      | Página pública que recibe un token en el fragmento de URL. Permite confirmar, cancelar según la política vigente o pedir un cambio de horario. |

## Desarrollo

Configurar `apps/frontend/.env.local` a partir de [la plantilla](.env.example). Usar la URL y la clave pública del mismo Supabase que consume el backend. Desde la raíz:

```sh
npm run dev:frontend
npm run test:config --workspace=apps/frontend
```

El frontend escucha en `http://localhost:3000` por defecto. En desarrollo consume `http://localhost:4000`. El entorno Docker puede ajustar este origen con `NEXT_PUBLIC_API_URL`. En un build publicado, Next.js incorpora al bundle los valores `NEXT_PUBLIC_*`. Se requieren los dos orígenes HTTPS de API y `NEXT_PUBLIC_USE_AZURE` selecciona Azure cuando vale `true`. Consultar la [guía de Vercel](../../infra/vercel/README.md) para Preview y Production y la [guía de pruebas](../../tests/README.md) para Playwright.

Los archivos bajo `src/app/(app)/` usan la sesión del personal. Las pantallas llaman a la API desde `src/lib/api.ts` y muestran los horarios en la zona del negocio. `src/app/turno/gestionar` queda fuera del layout autenticado.

## Interfaz y sincronización

- **Servicios.** Los tres indicadores blancos muestran el total del catálogo, sus servicios activos y las horas de las franjas activas guardadas. Búsqueda, filtro Todos/Activos/Inactivos y paginación se aplican al catálogo cargado. Edición y activación/desactivación reutilizan los formularios y permisos existentes.
- **Disponibilidad.** Una grilla muestra los siete días, las jornadas partidas y los días cerrados. Cada día abre un modal para habilitar atención, agregar o eliminar franjas y copiar horarios con advertencia de reemplazo. El borrador y las validaciones se conservan al cerrar el modal; Guardar persiste la semana. En escritorio, catálogo y disponibilidad comparten altura mediante grid; en pantallas pequeñas se apilan con altura automática.
- **Consulta de horarios.** El panel colapsable muestra resultados después de Consultar, con estados de carga, error y ausencia de slots. Seleccionar un horario solo lo resalta: consultar o seleccionar no reserva.
- **Configuración.** Datos del negocio y preferencias tienen guardado independiente. Las notificaciones se organizan en dos tarjetas desde 900 px, con acciones de guardado sticky y aviso de cambios pendientes. Los controles dependientes se deshabilitan con su función principal. La vista previa utiliza el HTML del backend, mantiene selector y Cerrar visibles y concentra el scroll en el correo.
- **Campana global.** Está a la derecha de un header global fijo de 48 px, separado del sidebar, en todas las pantallas privadas. Comparte contador e historial en Agenda, Servicios, Clientes, Configuración, detalle y centro de notificaciones. Al navegar desde la campana o un toast se respeta la confirmación de disponibilidad sin guardar. Los avisos próximos de agenda se pausan mientras el historial está abierto.
- **Toasts y navegación.** Los avisos nuevos sin leer se encolan y deduplican por ID; la cola se pausa mientras el popover está abierto para no tapar sus controles. Las solicitudes ofrecen «Revisar solicitud»; los próximos sin confirmar, «Gestionar turno»; los demás eventos con turno asociado, «Ver turno». Agenda reutiliza su aviso de próximos para evitar duplicarlo. Abrir o cerrar un toast no marca lectura ni resuelve solicitudes. El detalle consulta el estado vigente y enfoca la revisión, indicando solicitudes resueltas, turnos cerrados o avisos anteriores. Las actualizaciones automáticas no vuelven a mover el foco. La lectura desde el centro conserva el aviso en el historial y tampoco resuelve la solicitud. La confirmación de rechazo queda vinculada a la solicitud revisada y se deshabilita si otra sesión la reemplazó.
- **Regreso a Agenda.** El detalle muestra «Agenda > Detalle del turno» encima del título. El calendario conserva fecha y vista durante el día mediante sessionStorage, aisladas por negocio, usuario y zona horaria. Sin almacenamiento disponible utiliza la vista inicial habitual. No hay filtros adicionales de calendario que restaurar.
- **Actualización automática.** `NotificationProvider` consulta el endpoint existente cada cinco segundos con la pestaña visible y al recuperar foco o visibilidad. Notificaciones nuevas invalidan el feed diario y el rango visible del calendario sin cambiar la vista ni cerrar el formulario de reserva. Las cancelaciones y solicitudes de reprogramación muestran toasts en la zona horaria del negocio. La carga inicial es silenciosa; los IDs ya observados evitan repeticiones y mostrar un toast no marca la notificación como leída. Hay reconciliación completa cada minuto y ante cambios para recuperar eventos publicados tarde; la agenda también conserva su refresco de recuperación de un minuto.

## Pendientes

El [backlog](../../docs/backlog.md) reúne el trabajo pendiente, incluidos el recorrido publicado de los enlaces, la cobertura de navegador con API real y las funcionalidades de cuenta fuera del flujo actual.
