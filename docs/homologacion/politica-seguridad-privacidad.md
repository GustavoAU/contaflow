# POLÍTICA DE SEGURIDAD Y PRIVACIDAD DE DATOS
# ContaFlow — Versión 1.0.0

**Providencia Administrativa SNAT/2024/000121**
Barquisimeto, Estado Lara — Venezuela — Año 2026

---

## I. ALCANCE Y OBJETIVOS

### 1.1 Alcance

La presente Política de Seguridad y Privacidad de Datos aplica a:

- El sistema ContaFlow v1.0.0 en su totalidad
- Toda la infraestructura de alojamiento y procesamiento de datos
- Los datos de los contribuyentes (empresas clientes) y sus empleados/usuarios
- Los datos fiscales procesados en nombre de los contribuyentes
- Los proveedores de servicios en la nube que integran el sistema

### 1.2 Objetivos

1. Garantizar la integridad, confidencialidad y disponibilidad de los datos fiscales de los contribuyentes
2. Cumplir con los requisitos técnicos de seguridad establecidos en la Providencia Administrativa SNAT/2024/000121
3. Proteger los datos personales de usuarios y empleados conforme a las leyes venezolanas aplicables
4. Establecer procedimientos claros de respuesta ante incidentes de seguridad
5. Documentar las obligaciones del proveedor para con el SENIAT y los contribuyentes

---

## II. CLASIFICACIÓN DE LA INFORMACIÓN

### 2.1 Categorías de Datos

| Categoría | Ejemplos | Nivel de Protección |
|---|---|---|
| **Datos Fiscales Críticos** | Facturas, números de control, montos IVA, retenciones, Forma 30 | Máximo — cifrado en tránsito y reposo |
| **Datos Identificativos del Contribuyente** | RIF, razón social, dirección fiscal, teléfono | Alto |
| **Datos Contables** | Asientos, transacciones, plan de cuentas | Alto |
| **Datos de Nómina** | Salarios, cédulas de empleados, IVSS, prestaciones | Alto — acceso restringido a roles autorizados |
| **Datos de Autenticación** | Contraseñas (hash), tokens de sesión | Máximo — gestionado exclusivamente por Clerk |
| **Certificados Digitales** | Claves privadas `.p12`, certificados X.509 | Máximo — cifrado AES-256-GCM, nunca expuesto al cliente |
| **Registros de Auditoría** | AuditLog con IP, UserAgent, acciones | Alto — inmutables (append-only) |
| **Datos de Uso** | Logs de sesión, métricas de rendimiento | Medio — solo para soporte técnico |

### 2.2 Datos que ContaFlow NO almacena

- Contraseñas en texto plano (gestionadas por Clerk con hash bcrypt)
- Datos de tarjetas de crédito o cuentas bancarias del contribuyente
- Información biométrica

---

## III. CONTROL DE ACCESO

### 3.1 Autenticación

**Autenticación de usuarios:** Gestionada por Clerk, proveedor certificado de identidad:
- Contraseñas con hash bcrypt (no reversible)
- Soporte de autenticación de dos factores (2FA) mediante TOTP
- Sesiones con tokens JWT firmados con rotación automática
- Detección de sesiones simultáneas sospechosas
- Cierre remoto de sesiones desde el panel de configuración

**Protección de operaciones críticas:**
Las siguientes operaciones requieren re-autenticación (step-up 2FA) independientemente de la sesión activa:
- Cierre de ejercicio fiscal
- Eliminación de miembros de la empresa
- Modificación de datos SENIAT de la empresa
- Archivado de la empresa

### 3.2 Autorización

**Principio de mínimo privilegio:** Cada usuario solo puede acceder a los datos y funcionalidades estrictamente necesarios para su rol.

**Aislamiento multi-tenant:** Cada consulta a la base de datos incluye obligatoriamente el `companyId` como filtro. Ningún usuario puede acceder a datos de una empresa a la que no pertenece. Este control es verificado en el servidor para cada operación (no basado en la UI solamente).

**Verificación de membresía:** Toda Server Action crítica verifica la existencia del registro `CompanyMember` para el par `(userId, companyId)` antes de procesar:

```
Acceso denegado si:
  - El usuario no existe en la empresa
  - El rol del usuario no tiene permiso para la operación
  - El período contable está cerrado
```

### 3.3 Gestión de Credenciales

- Las credenciales del proveedor de nube (API keys, secrets) se almacenan exclusivamente como variables de entorno en Vercel, nunca en el código fuente
- La clave de cifrado de certificados (`CERT_ENCRYPTION_SECRET`) nunca se almacena en la base de datos ni en logs
- Los tokens de acceso a servicios externos (QStash, Upstash) se rotan trimestralmente
- El repositorio de código fuente no contiene ninguna credencial de producción

---

## IV. SEGURIDAD DE DATOS EN TRÁNSITO Y REPOSO

### 4.1 Datos en Tránsito

| Canal | Protocolo | Versión mínima |
|---|---|---|
| Navegador → Vercel | HTTPS / TLS | TLS 1.2 (TLS 1.3 preferido) |
| Vercel → Neon PostgreSQL | TLS | 1.2 |
| Vercel → Upstash Redis | TLS | 1.2 |
| Vercel → QStash | HTTPS | TLS 1.2 |
| Vercel → Clerk | HTTPS | TLS 1.2 |
| Vercel → Sentry | HTTPS | TLS 1.2 |

El certificado SSL/TLS del dominio de producción es emitido por Let's Encrypt y renovado automáticamente por Vercel antes de su vencimiento.

### 4.2 Datos en Reposo

| Tipo de Dato | Mecanismo de Protección |
|---|---|
| Base de datos PostgreSQL | Cifrado en reposo por Neon (AES-256) |
| Claves privadas de certificados | AES-256-GCM con clave derivada del `companyId`, almacenada en variable de entorno |
| Documentos PDF firmados | SHA-256 hash de integridad almacenado en `AuditLog.contentHash` |
| Backups de base de datos | Cifrados por Neon, retenidos 7 días con Point-in-Time Recovery (PITR) |

### 4.3 Protección de Claves Privadas de Certificados Digitales

El proceso de manejo de claves privadas en ContaFlow sigue estrictamente el siguiente protocolo:

1. El archivo `.p12` del contribuyente es recibido en el servidor vía HTTPS
2. La clave privada es extraída y cifrada en memoria con AES-256-GCM
3. El buffer de la clave privada es borrado de memoria (`buf.fill(0)`) inmediatamente después del cifrado
4. El campo `encryptedP12` nunca aparece en respuestas al cliente (SELECT explícito que lo excluye siempre)
5. La clave de descifrado proviene exclusivamente de una variable de entorno de Vercel, nunca de la base de datos

---

## V. INTEGRIDAD Y TRAZABILIDAD DE DATOS FISCALES

### 5.1 Inmutabilidad de Registros Fiscales

Los registros fiscales son inalterables una vez emitidos:

- **Facturas**: no se modifican. Las correcciones se realizan mediante NC/ND vinculadas al documento original
- **Asientos contables**: publicados con estado `POSTED` no se eliminan. Las reversiones generan un asiento de contrapartida
- **Retenciones**: emitidas con estado `ISSUED` no se modifican
- **AuditLog**: registros de auditoría son exclusivamente de escritura — no existe operación de actualización ni eliminación

### 5.2 Registro de Auditoría

Todo acceso y modificación a datos fiscales genera un registro automático e inmutable en `AuditLog` con:
- Identidad del usuario (userId)
- Empresa afectada (companyId)
- Acción realizada
- Estado anterior y nuevo (snapshot JSON)
- Dirección IP del solicitante
- User-Agent del navegador
- Timestamp exacto del servidor

### 5.3 Hashes de Integridad Documental

Los PDFs de facturas y comprobantes generados incluyen:
- Firma digital del certificado X.509 de la empresa emisora
- Hash SHA-256 del contenido almacenado en `AuditLog.contentHash`
- Código QR con datos del documento para verificación independiente

---

## VI. SEGURIDAD DE LA APLICACIÓN

### 6.1 Protección contra OWASP Top 10

| Vulnerabilidad | Mecanismo de Mitigación |
|---|---|
| Inyección SQL | Prisma ORM con consultas parametrizadas — no existe SQL raw dinámico |
| Autenticación rota | Clerk gestiona autenticación con prácticas de la industria |
| Exposición de datos sensibles | TLS en todos los canales; campos sensibles excluidos de SELECT |
| XXE (XML Injection) | Librería de XML controlada, sin parsing de entrada del usuario |
| Control de acceso roto (IDOR) | Guard de `companyId` en 100% de Server Actions críticas |
| Configuración insegura | Headers de seguridad en middleware (X-Frame-Options, CSP, etc.) |
| Cross-Site Scripting (XSS) | React escapa por defecto; CSP con nonce y strict-dynamic |
| Deserialización insegura | Zod 4 valida y tipifica toda entrada del usuario |
| Componentes vulnerables | Auditorías de dependencias con `npm audit`; actualizaciones trimestrales |
| Logging insuficiente | AuditLog automático en 44+ operaciones; Sentry para errores en producción |

### 6.2 Validación de Entrada

- **Zod 4** valida y tipifica toda entrada en Server Actions — nunca se procesan datos del cliente sin validación
- Los montos fiscales (alícuotas IVA, tasas ISLR, IGTF) son constantes del servidor — el cliente no puede enviar tasas modificadas
- El RIF es validado con expresión regular antes de almacenar: `/^[JVEGCP]-\d{8}-?\d?$/i`
- Las fechas son validadas contra el período contable activo

### 6.3 Rate Limiting

El sistema implementa control de abuso mediante ventanas deslizantes de Upstash Redis:

| Operación | Límite | Ventana |
|---|---|---|
| Creación de facturas y documentos fiscales | 30 solicitudes | 1 minuto |
| OCR de documentos | 10 solicitudes | 1 minuto |
| Exportación de datos | 5 solicitudes | 1 minuto |
| Transmisión SENIAT | Gestionado por QStash | Backoff exponencial |

Si el servicio Redis no está disponible, el sistema opera en modo permisivo (fail-open) para no interrumpir operaciones fiscales críticas.

### 6.4 Protección de Webhooks

El webhook `/api/webhooks/seniat-report` verifica la firma HMAC-SHA256 de QStash antes de procesar cualquier payload. Requests sin firma válida son rechazados con HTTP 401.

---

## VII. GESTIÓN DE VULNERABILIDADES E INCIDENTES

### 7.1 Monitoreo Continuo

- **Sentry**: captura automática de errores en producción con trazas de stack y contexto del usuario
- **Sentry Performance**: spans de rendimiento en 6 operaciones críticas (correlativos, GL posting, cierre, apropiación, nómina, transmisión SENIAT)
- **Health endpoint**: `GET /api/health` retorna estado de BD, Redis y QStash para monitoreo externo
- **GitHub Actions**: CI/CD con gate de calidad en cada merge (tsc + vitest)

### 7.2 Gestión de Dependencias

- Auditoría de dependencias con `npm audit` en cada ciclo de desarrollo
- Actualizaciones de seguridad aplicadas dentro de 72 horas para vulnerabilidades críticas (CVSS ≥ 9.0)
- Actualizaciones de seguridad aplicadas dentro de 7 días para vulnerabilidades altas (CVSS 7.0–8.9)

### 7.3 Clasificación de Incidentes

| Severidad | Descripción | Tiempo de Respuesta | Notificación SENIAT |
|---|---|---|---|
| **CRÍTICO** | Brecha de datos fiscales, acceso no autorizado a BD | 1 hora | 24 horas |
| **ALTO** | Vulnerabilidad de seguridad activa, datos expuestos | 4 horas | 24 horas (si hay datos fiscales) |
| **MEDIO** | Degradación del servicio, error de integridad | 24 horas | No aplica |
| **BAJO** | Error de UI, inconsistencia menor | 72 horas | No aplica |

### 7.4 Procedimiento de Respuesta a Incidentes

```
1. DETECCIÓN
   Sentry alerta automática → equipo técnico

2. CLASIFICACIÓN (0–30 min)
   Determinar severidad y alcance
   Identificar datos afectados

3. CONTENCIÓN (30 min – 4 horas)
   Aislar el componente afectado
   Revocar credenciales comprometidas (si aplica)
   Activar modo de solo lectura (si aplica)

4. NOTIFICACIÓN (si Crítico o Alto con datos fiscales)
   Notificar al SENIAT dentro de 24 horas
   Notificar a contribuyentes afectados

5. ERRADICACIÓN
   Corregir la vulnerabilidad
   Aplicar parche y redesplegar
   Verificar integridad de datos fiscales

6. RECUPERACIÓN
   Restaurar desde backup PITR de Neon (si aplica)
   Verificar que AuditLog esté íntegro
   Confirmar que hashes SHA-256 de documentos coinciden

7. POSTMORTEM
   Documentar causa raíz
   Actualizar políticas y controles
   Comunicar lecciones aprendidas
```

---

## VIII. CONTINUIDAD OPERATIVA Y RECUPERACIÓN

### 8.1 Objetivos de Recuperación

| Métrica | Objetivo |
|---|---|
| RTO (Recovery Time Objective) | < 4 horas |
| RPO (Recovery Point Objective) | < 1 hora |
| Retención de backups | 7 días (PITR Neon) |

### 8.2 Estrategia de Backup

- **Base de Datos**: Neon Serverless realiza backups continuos con Point-in-Time Recovery (PITR) de 7 días. No se requiere acción manual.
- **Documentos PDF**: Almacenados en Vercel Blob Storage con replicación geográfica. Los hashes SHA-256 almacenados en `AuditLog` permiten verificar integridad en cualquier momento.
- **Código fuente**: Repositorio en GitHub con historial completo de commits.

### 8.3 Procedimiento de Restauración

1. Identificar el punto en el tiempo a restaurar (basado en AuditLog)
2. Activar PITR en Neon desde el panel de administración
3. Especificar el timestamp exacto
4. Neon restaura la base de datos a ese punto
5. Verificar integridad de los últimos documentos fiscales (SHA-256)
6. Notificar a contribuyentes afectados del rango de datos restaurado

---

## IX. PRIVACIDAD DE DATOS PERSONALES

### 9.1 Datos Personales Procesados

ContaFlow procesa los siguientes datos personales como encargado de tratamiento en nombre del contribuyente:

| Tipo de Dato | Propietario | Finalidad |
|---|---|---|
| Nombre, Cédula, RIF de empleados | Contribuyente | Cálculo de nómina |
| Salario y beneficios de empleados | Contribuyente | Procesamiento de nómina y aportes |
| Correo electrónico de usuarios | Usuario | Autenticación y notificaciones |
| Dirección IP y User-Agent | Procesado en tránsito | Auditoría fiscal (PA-121 requisito) |
| RIF de clientes/proveedores | Contribuyente | Documentos fiscales |

### 9.2 Principios de Tratamiento de Datos

- **Finalidad**: Los datos se procesan exclusivamente para los fines declarados (gestión administrativa-contable y cumplimiento fiscal)
- **Minimización**: Solo se recopilan los datos estrictamente necesarios
- **Exactitud**: El contribuyente puede actualizar sus datos en cualquier momento
- **Limitación del plazo**: Los datos se conservan mientras el contribuyente mantenga su cuenta activa. Al cerrar la cuenta, el contribuyente puede exportar sus datos y solicitar la eliminación
- **Seguridad**: Medidas técnicas descritas en las secciones anteriores de esta política

### 9.3 Derechos del Contribuyente sobre sus Datos

El contribuyente (como titular del tratamiento de datos) puede en todo momento:

- **Acceder** a todos sus datos mediante la función de exportación ZIP
- **Rectificar** datos incorrectos desde la interfaz del sistema
- **Exportar** todos sus datos en formatos estándar (CSV, PDF, JSON)
- **Solicitar eliminación** al cerrar la cuenta (sujeto a períodos de retención legal obligatoria para documentos fiscales)

### 9.4 Períodos de Retención

| Tipo de Dato | Período de Retención | Base Legal |
|---|---|---|
| Documentos fiscales (facturas, retenciones) | 5 años mínimo | Código Orgánico Tributario |
| AuditLog de operaciones fiscales | 5 años mínimo | PA-121 Art. 3 |
| Datos de nómina | 5 años mínimo | LOTTT |
| Datos de acceso (sesiones) | 90 días | Política interna |

---

## X. PROVEEDORES Y TERCEROS

### 10.1 Proveedores de Servicios en la Nube

| Proveedor | Servicio | Datos que Procesa | Certificaciones |
|---|---|---|---|
| Vercel | Alojamiento de la aplicación | Requests HTTP, código | SOC 2 Type II |
| Neon | Base de datos PostgreSQL | Todos los datos del contribuyente | SOC 2 Type II |
| Clerk | Autenticación | Credenciales de usuarios | SOC 2 Type II |
| Upstash | Redis + QStash | Tokens de rate limit, colas SENIAT | SOC 2 Type II |
| Google (Gemini) | OCR de documentos | Imágenes de facturas de proveedores | ISO 27001 |
| Sentry | Monitoreo de errores | Stack traces (sin datos fiscales) | SOC 2 Type II |

### 10.2 Protección de Datos con Terceros

- Los datos de autenticación son gestionados exclusivamente por Clerk — ContaFlow nunca almacena contraseñas
- El OCR de Gemini procesa imágenes de facturas pero no recibe datos de la base de datos del contribuyente
- Sentry recibe stack traces sanitizados — los datos fiscales (montos, RIF, nombres de clientes) son marcados como datos sensibles y no se envían a Sentry

---

## XI. OBLIGACIONES DEL PROVEEDOR ANTE EL SENIAT

Conforme al Artículo 9 de la Providencia Administrativa SNAT/2024/000121, ContaFlow se compromete a:

1. **Comercializar únicamente la versión homologada y autorizada** por el SENIAT
2. **Re-homologar** cualquier versión que modifique la lógica de facturación fiscal antes de su distribución
3. **Notificar al SENIAT dentro de 24 horas** ante incidentes de seguridad que comprometan la integridad de datos fiscales
4. **Mantener disponible el acceso del rol SENIAT** para fiscalización en todo momento
5. **Alertar automáticamente** cuando se detecte uso de una versión no homologada
6. **Proveer toda la información adicional** que la Administración Tributaria requiera para sus procesos de auditoría y fiscalización

---

## XII. REVISIÓN Y ACTUALIZACIÓN

Esta política es revisada:
- Anualmente como mínimo
- Ante cambios significativos en la arquitectura del sistema
- Ante nuevas regulaciones o directrices del SENIAT
- Después de cualquier incidente de seguridad de severidad ALTO o CRÍTICO

La versión vigente se mantiene accesible en la ruta `/legal/politica-privacidad` del sistema.

---

**Emisor:** [NOMBRE COMPLETO DEL PROVEEDOR]
**Cargo:** Desarrollador y Proveedor del Sistema ContaFlow
**Lugar y Fecha:** Barquisimeto, Estado Lara — [FECHA]
**Firma:** ___________________________________

---

*ContaFlow v1.0.0 — Política de Seguridad y Privacidad de Datos — Providencia Administrativa SNAT/2024/000121*
*Barquisimeto, Estado Lara — Venezuela — 2026*
