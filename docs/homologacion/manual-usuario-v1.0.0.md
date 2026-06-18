# MANUAL DE USUARIO
# ContaFlow — Versión 1.0.0

**Providencia Administrativa SNAT/2024/000121**
Barquisimeto, Estado Lara — Venezuela — Año 2026

---

## I. INTRODUCCIÓN

ContaFlow es un sistema administrativo-contable web orientado a PYMES, medianas empresas y contadores particulares en Venezuela. Permite gestionar facturación fiscal, contabilidad, inventario, nómina y todos los reportes requeridos por el SENIAT desde cualquier dispositivo con acceso a internet.

### Requisitos del Usuario

- Navegador web moderno (Chrome 90+, Firefox 88+, Safari 14+, Edge 90+)
- Conexión a internet
- Credenciales de acceso (correo electrónico y contraseña)
- RIF vigente del contribuyente

---

## II. ACCESO AL SISTEMA

### 2.1 Registro de Cuenta

1. Ingresar a la URL del sistema ContaFlow
2. Hacer clic en **Crear cuenta**
3. Ingresar correo electrónico y contraseña (mínimo 8 caracteres, una mayúscula, un número)
4. Verificar el correo electrónico mediante el enlace enviado
5. Una vez verificado, ingresar con las credenciales creadas

### 2.2 Inicio de Sesión

1. Ingresar la URL del sistema en el navegador
2. Ingresar correo electrónico y contraseña
3. El sistema redirige al **Panel Principal (Dashboard)**

### 2.3 Autenticación de Dos Factores (2FA)

Para mayor seguridad, el sistema soporta autenticación de dos factores (2FA). Para activarla:

1. Ir a **Configuración → Mi Perfil → Seguridad**
2. Activar **Autenticación de dos factores**
3. Escanear el código QR con una aplicación autenticadora (Google Authenticator, Authy)
4. Confirmar con el código de 6 dígitos generado

**Nota:** Las operaciones críticas (cierre de ejercicio fiscal, eliminación de miembros, configuración SENIAT) requieren confirmación 2FA adicional por seguridad.

---

## III. GESTIÓN DE EMPRESAS

### 3.1 Crear una Empresa

1. Desde el **Dashboard**, hacer clic en **Nueva Empresa**
2. Completar el formulario:
   - **RIF**: formato `J-XXXXXXXX-X` / `V-XXXXXXXX` / `E-XXXXXXXX`
   - **Razón Social**: nombre completo de la empresa
   - **Nombre Comercial**: nombre visible en facturas
   - **Dirección Fiscal**: dirección legal del contribuyente
   - **Teléfono** y **Correo electrónico fiscal**
   - **Tipo de Contribuyente**: Regular / Especial
   - **Actividad Económica (CIIU)**
   - **Perfil del sistema**: seleccionar el tipo de uso
     - **Individual / Autónomo**: contador o profesional independiente ($69/mes)
     - **Empresa**: PYME o empresa ($79/mes)
     - **Despacho Contable**: bufete o contador que gestiona múltiples empresas ($119–$359/mes según cantidad de RIFs)
3. Hacer clic en **Crear Empresa**
4. El sistema genera automáticamente el certificado digital demo de la empresa

### 3.2 Cambiar entre Empresas

El **Selector de Empresa** en la parte superior del menú lateral permite cambiar entre empresas con un solo clic. Solo se muestran las empresas a las que el usuario tiene acceso.

### 3.3 Configuración de la Empresa

Desde **Configuración → Datos de la Empresa**:

- **Datos SENIAT**: domicilio fiscal, dirección, teléfono SENIAT (requiere confirmación 2FA)
- **Firma Digital**: cargar certificado `.p12` del proveedor acreditado (PSC World, SUSCERTE)
- **Número de Control Inicial**: configurar el correlativo de inicio de numeración
- **Plan de Cuentas**: activar o personalizar cuentas contables

### 3.4 Gestión de Miembros y Roles

Desde **Configuración → Miembros**:

| Acción | Descripción |
|---|---|
| Invitar usuario | Enviar invitación por correo con rol asignado |
| Cambiar rol | Modificar permisos de un miembro existente |
| Remover miembro | Revocar acceso (requiere confirmación 2FA) |
| Rol SENIAT | Crear acceso de solo lectura para el fiscal del SENIAT |

**Roles disponibles:**
- **Propietario (OWNER)**: acceso total, billing, datos SENIAT
- **Administrador (ADMIN)**: acceso total excepto billing
- **Contador (ACCOUNTANT)**: contabilidad, facturación, nómina, reportes
- **Administrativo (ADMINISTRATIVE)**: facturación, compras, ventas
- **Lector (VIEWER)**: solo lectura de todos los módulos
- **SENIAT**: solo lectura de informes de auditoría fiscal

---

## IV. FACTURACIÓN FISCAL

### 4.1 Crear Factura de Venta

1. En el menú lateral, ir a **Facturación → Nueva Factura**
2. Seleccionar **Tipo**: Factura de Venta
3. Completar los datos del cliente:
   - Buscar por nombre o RIF (el sistema autocompleta si existe en el directorio)
   - Para clientes nuevos, completar RIF, razón social, dirección
4. Seleccionar **Moneda** (VES, USD, EUR u otra)
5. Ingresar las líneas de producto/servicio:
   - Descripción, cantidad, precio unitario
   - **Categoría fiscal**: Gravada General / Gravada Reducida / Gravada Lujo / Exenta / Exonerada
6. El sistema calcula automáticamente:
   - Base imponible por alícuota
   - IVA (16% / 8% / 31% según categoría)
   - IGTF (si aplica según moneda y condición del contribuyente)
7. Hacer clic en **Emitir Factura**

**Resultado:** Se generan automáticamente:
- PDF firmado digitalmente para descarga/envío al cliente
- Asiento contable en el Libro Diario
- Registro `SeniatSubmission` para transmisión al SENIAT
- Entrada en el Audit Log con IP y UserAgent

**Número de Control:** El sistema asigna automáticamente el siguiente número correlativo disponible en formato `00-XXXXXXXX`.

### 4.2 Crear Factura de Compra

1. Ir a **Facturación → Nueva Factura → Compra**
2. Seleccionar o crear el proveedor (con RIF)
3. Ingresar el **Número de Control** de la factura recibida del proveedor
4. Completar líneas y categorías fiscales igual que la factura de venta
5. Hacer clic en **Registrar Factura**

**Nota:** Para facturas de compra con soporte físico en papel, se puede usar el módulo OCR para extraer automáticamente los datos.

### 4.3 Usar OCR para Facturas de Compra

1. En el formulario de factura de compra, hacer clic en **Escanear Factura**
2. Cargar la imagen o PDF de la factura física
3. El sistema extrae automáticamente: proveedor, RIF, número de control, fecha, líneas e importes
4. Revisar y confirmar los datos extraídos
5. Completar campos faltantes si los hay
6. Emitir la factura

### 4.4 Crear Nota de Crédito

Las notas de crédito corrigen o anulan parcial o totalmente una factura emitida.

1. Desde el **Libro de Facturas**, ubicar la factura a corregir
2. Hacer clic en **Emitir Nota de Crédito**
3. Seleccionar el motivo de la corrección
4. Ingresar el importe de la nota de crédito
5. El sistema vincula automáticamente el `relatedDocNumber` a la factura original
6. Hacer clic en **Emitir Nota de Crédito**

### 4.5 Crear Nota de Débito

1. Desde el **Libro de Facturas**, ubicar la factura base
2. Hacer clic en **Emitir Nota de Débito**
3. Ingresar el motivo y el monto adicional a cargar al cliente
4. El sistema vincula automáticamente el `relatedDocNumber`
5. Hacer clic en **Emitir Nota de Débito**

### 4.6 Registrar Pago de Factura

1. Desde el **Libro de Facturas**, hacer clic en la factura
2. Hacer clic en **Registrar Pago**
3. Ingresar:
   - Monto pagado
   - Fecha del pago
   - Medio de pago (efectivo VES, transferencia, divisas, Zelle, criptomonedas)
   - Moneda del pago
4. El sistema calcula automáticamente el IGTF si corresponde
5. Confirmar el pago

### 4.7 Libro de Facturas

El **Libro de Facturas** muestra todas las facturas, NC y ND con filtros por:
- Tipo (venta / compra)
- Período (fecha desde / hasta o período contable)
- Estado (borrador / emitida / anulada)
- Moneda
- Contribuyente

Desde el libro se puede:
- Descargar PDF de cualquier documento
- Exportar a Excel
- Descargar XML SENIAT para carga en el portal declaraciones.seniat.gob.ve
- Ver el estado de transmisión al SENIAT

---

## V. RETENCIONES

### 5.1 Comprobante de Retención IVA

Solo aplicable si la empresa es **Contribuyente Especial**.

1. Ir a **Retenciones → Nueva Retención IVA**
2. Seleccionar la factura del proveedor a retener
3. El sistema calcula automáticamente:
   - Base de retención
   - Porcentaje (75% o 100% según el caso)
   - Monto retenido
4. Hacer clic en **Emitir Comprobante**

El sistema asigna el número correlativo `CR-XXXXXXXX` y genera:
- PDF del comprobante con código QR de verificación
- Asiento contable automático (Débito IVA Crédito Fiscal / Crédito Retenciones por Enterar)

### 5.2 Comprobante de Retención ISLR

1. Ir a **Retenciones → Nueva Retención ISLR**
2. Seleccionar el proveedor y la factura
3. Seleccionar el **Concepto de pago** (más de 60 conceptos del Decreto 1808)
   - El sistema sugiere automáticamente el porcentaje aplicable
4. Confirmar o ajustar el porcentaje y el monto
5. Hacer clic en **Emitir Comprobante**

### 5.3 Enteramiento de Retenciones

Cuando se realiza el pago al SENIAT de las retenciones acumuladas:

1. Ir a **Retenciones → Enteramiento**
2. El sistema muestra el total de retenciones IVA e ISLR por enterar
3. Seleccionar el período y registrar el pago
4. El sistema genera el asiento contable de enteramiento (Débito Retenciones por Enterar / Crédito Banco)

---

## VI. DECLARACIONES FISCALES

### 6.1 Libro de Compras y Libro de Ventas

1. Ir a **Reportes Fiscales → Libros IVA**
2. Seleccionar el período (mes y año)
3. El sistema genera automáticamente el Libro de Ventas y el Libro de Compras con las columnas exactas requeridas por la PA 0071:
   - Número de control, RIF, nombre, fecha, base imponible por alícuota, IVA, retenciones, IGTF, total
4. Descargar en formato:
   - **PDF** para archivo y presentación
   - **Excel** para verificación
   - **XML SENIAT** para carga directa en el portal

### 6.2 Declaración Forma 30 IVA

1. Ir a **Reportes Fiscales → Forma 30**
2. Seleccionar mes y año del período a declarar
3. El sistema calcula automáticamente todas las secciones:
   - **Sección A**: Débitos fiscales (ventas por alícuota)
   - **Sección B**: Créditos fiscales (compras por alícuota)
   - **Sección C**: Retenciones IVA practicadas y sufridas
   - **Sección D**: IGTF
   - **Sección E**: Cuota tributaria o saldo a favor
4. Revisar los totales
5. Descargar el PDF de la Forma 30 para presentar ante el SENIAT
6. Si hay excedente de crédito fiscal, usar el botón **"Usar como crédito anterior"** en el mes siguiente

---

## VII. CONTABILIDAD

### 7.1 Asientos Manuales

1. Ir a **Contabilidad → Nuevo Asiento**
2. Completar:
   - Fecha del asiento
   - Número de referencia (opcional)
   - Descripción del asiento
3. Agregar líneas de debe y haber:
   - Seleccionar cuenta del Plan de Cuentas
   - Ingresar monto
4. El sistema valida que `Total Debe = Total Haber` antes de permitir guardar
5. Hacer clic en **Publicar Asiento**

### 7.2 Libro Diario

1. Ir a **Contabilidad → Libro Diario**
2. Filtrar por período, tipo de asiento o búsqueda de texto
3. Ver todos los asientos ordenados cronológicamente
4. Hacer clic en cualquier asiento para ver el detalle y las líneas débito/crédito
5. Exportar a PDF (incluye firma del contador al pie)

### 7.3 Libro Mayor

1. Ir a **Contabilidad → Libro Mayor**
2. Seleccionar la cuenta contable a consultar
3. Filtrar por período contable
4. El sistema muestra el movimiento de la cuenta: saldo anterior, movimientos del período, saldo final
5. Exportar a PDF (incluye encabezado con período y firma del contador)

### 7.4 Estados Financieros

Desde **Contabilidad → Reportes**:

| Reporte | Descripción |
|---|---|
| Balance General | Activo / Pasivo / Patrimonio a fecha determinada |
| Estado de Resultados | Ingresos / Costos / Gastos del período. Soporta comparación con período anterior |
| Balance de Comprobación | Saldos por cuenta con subtotales. Exportable a PDF con firma |
| Libro Mayor por Cuenta | Movimientos detallados por cuenta seleccionada |

### 7.5 Períodos Contables

1. Ir a **Contabilidad → Períodos**
2. Los períodos se crean automáticamente mes a mes
3. Para cerrar un período: hacer clic en **Cerrar Período**
4. Un período cerrado no permite nuevas mutaciones financieras — solo lectura
5. El cierre de año fiscal requiere confirmación 2FA

### 7.6 Ajuste por Inflación (INPC)

1. Ir a **Contabilidad → Ajuste INPC**
2. Verificar que los índices INPC estén actualizados (el sistema los carga automáticamente)
3. Hacer clic en **Calcular Preview** para ver el impacto del ajuste antes de aplicarlo
4. Revisar el asiento propuesto
5. Hacer clic en **Aplicar Ajuste** para confirmar

---

## VIII. INVENTARIO

### 8.1 Crear Ítem de Inventario

1. Ir a **Inventario → Nuevo Ítem**
2. Completar:
   - **Nombre** y **Código** del producto
   - **Tipo**: Mercancía / Materia Prima / Producto Terminado / Servicio
   - **Unidad de Medida base**
   - **Cuenta de Inventario** (activo) y **Cuenta COGS** (costo de ventas)
   - **Stock mínimo** (para alerta de bajo stock)
3. Hacer clic en **Crear Ítem**

### 8.2 Movimientos de Inventario

**Entrada de inventario:**
1. Ir a **Inventario → Nuevo Movimiento → Entrada**
2. Seleccionar ítem, cantidad, costo unitario y fecha
3. El sistema actualiza el Costo Promedio Ponderado (CPP) y genera el asiento: `Débito Inventario / Crédito Proveedor`

**Salida de inventario:**
1. Ir a **Inventario → Nuevo Movimiento → Salida**
2. Seleccionar ítem y cantidad
3. El sistema calcula el costo al CPP vigente y genera: `Débito COGS / Crédito Inventario`

### 8.3 Alertas de Stock

El dashboard muestra automáticamente una alerta cuando un ítem cae por debajo del stock mínimo configurado. También alerta cuando ítems físicos (mercancía) no tienen cuentas contables GL asignadas.

### 8.4 Control de Lotes y Series

Para productos con control de lotes o números de serie:
1. Ir a **Inventario → Lotes** o **Inventario → Series**
2. Al registrar una entrada de inventario, asignar el número de lote o serie
3. Al emitir una factura de venta, el sistema solicita seleccionar el lote/serie a descontar
4. El **Libro de Movimientos** muestra la trazabilidad completa por lote/serie

---

## IX. NÓMINA

### 9.1 Configuración de Nómina

Antes de procesar la primera nómina, configurar en **Nómina → Configuración**:

- Fecha de inicio del período de cálculo de antigüedad
- Salario mínimo vigente
- Tipo de jornada laboral (5 días / 6 días)
- Tope IVSS, INCES, Banavih (el sistema actualiza los topes legales automáticamente)
- Cuentas contables para asientos de nómina

### 9.2 Registrar Empleado

1. Ir a **Nómina → Empleados → Nuevo Empleado**
2. Completar datos: nombre, cédula, cargo, salario base, fecha de ingreso
3. Configurar:
   - Deducciones adicionales (si aplica)
   - Beneficios adicionales (si aplica)
   - Modalidad de pago (banco / efectivo)
4. Guardar

### 9.3 Procesar Nómina

1. Ir a **Nómina → Nueva Nómina**
2. Seleccionar período (quincena / mensual)
3. El sistema calcula automáticamente para cada empleado:
   - Salario base + horas extras + beneficios
   - Deducciones: IVSS (4%), INCES (0.5%), Banavih FAOV, ARC ISLR
   - Prestaciones sociales del mes (Art. 142 LOTTT)
4. Revisar el resumen y los totales
5. Hacer clic en **Aprobar Nómina** (requiere confirmación)
6. El sistema genera:
   - Recibos de pago individuales en PDF
   - Asiento contable de la nómina
   - Archivo TXT bancario para pagos masivos

### 9.4 Vacaciones y Utilidades

- **Vacaciones**: Ir a **Nómina → Vacaciones → Calcular**. El sistema muestra días correspondientes y el bono vacacional. Exporta el recibo en PDF.
- **Utilidades**: Ir a **Nómina → Utilidades → Calcular**. El sistema calcula el equivalente de días por trabajador según el ejercicio fiscal.

---

## X. ACTIVOS FIJOS

### 10.1 Registrar Activo Fijo

1. Ir a **Activos Fijos → Nuevo Activo**
2. Completar:
   - Descripción, categoría, fecha de adquisición
   - Valor de adquisición (en Bs. o divisas)
   - Vida útil estimada (en años/meses)
   - Método de depreciación: Línea Recta / Suma de Dígitos / Unidades de Producción
   - Cuenta contable del activo y de depreciación acumulada
3. Guardar

### 10.2 Calcular Depreciación

1. Ir a **Activos Fijos → Depreciar**
2. Seleccionar el mes a depreciar
3. El sistema calcula la depreciación de todos los activos activos para ese mes
4. Hacer clic en **Aplicar Depreciación**
5. Se generan los asientos: `Débito Gasto Depreciación / Crédito Depreciación Acumulada`

---

## XI. REPORTES Y EXPORTACIÓN

### 11.1 Reporte Forma 30 (ya descrito en sección VI)

### 11.2 Libros IVA en Excel y XML (ya descrito en sección VI)

### 11.3 Exportación de Datos (ZIP — Portabilidad)

1. Ir a **Configuración → Exportar Datos**
2. Seleccionar rango de fechas o activar **"Todo el historial"**
3. Hacer clic en **Generar y Descargar**
4. El sistema genera un archivo ZIP con:
   - `libros-iva/libro-ventas.csv`
   - `libros-iva/libro-compras.csv`
   - `retenciones/retenciones.csv`
   - `asientos/asientos.csv`
   - `activos/activos-fijos.csv`
   - `nomina/empleados.csv`
   - `nomina/nominas-aprobadas.csv`
   - `inventario/items.csv`
   - `gastos/gastos.csv`
   - `forma-30/forma30.csv`
   - `LEEME.txt` (metadatos de la exportación)

---

## XII. ASISTENTE CONTABLE IA

ContaFlow incluye un asistente contable basado en inteligencia artificial que puede:

- Responder preguntas sobre asientos contables específicos de la empresa
- Detectar anomalías fiscales (facturas duplicadas, montos inusuales, períodos inconsistentes)
- Sugerir el concepto ISLR correcto para una retención
- Explicar el cálculo de un impuesto específico

**Acceso:** Ícono de asistente en el menú lateral o en la esquina de la pantalla.

**Privacidad:** Las consultas usan únicamente datos de la empresa activa y no se comparten con terceros.

---

## XIII. CONCILIACIÓN BANCARIA

1. Ir a **Conciliación Bancaria → Nueva Conciliación**
2. Seleccionar la cuenta bancaria y el período
3. Importar el extracto bancario:
   - **Manual**: ingresar movimientos manualmente
   - **OCR**: cargar el PDF del extracto bancario para extracción automática
4. El sistema realiza la conciliación automática (3-way match) comparando movimientos del banco con asientos del Libro Mayor
5. Identificar y marcar los movimientos no conciliados
6. Confirmar la conciliación del período

---

## XIV. ACCESO ESPECIAL SENIAT

La empresa puede otorgar acceso de solo lectura al personal del SENIAT para fiscalización:

1. Ir a **Configuración → Miembros → Invitar**
2. Ingresar el correo del funcionario del SENIAT
3. Asignar el rol **SENIAT**
4. El funcionario recibirá acceso exclusivo a:
   - Auditoría de facturas (todas las emitidas, incluyendo anuladas, con número de control, RIF, montos e IVA)
   - Auditoría de caja (movimientos con usuario, fecha, IP, monto y tipo)
5. El rol SENIAT **no puede** crear, modificar ni anular ningún documento

---

## XV. MENSAJES DE ADVERTENCIA FRECUENTES

| Mensaje | Causa | Acción |
|---|---|---|
| "Período cerrado — operación no permitida" | Intento de registrar en período CLOSED | Crear asiento en período actual |
| "Error transitorio — intenta de nuevo" | Conflicto de concurrencia en correlativo | Hacer clic en Reintentar |
| "Sin acceso a este módulo" | Rol sin permiso para el módulo | Contactar al ADMIN de la empresa |
| "RIF inválido" | Formato de RIF incorrecto | Verificar formato J-XXXXXXXX-X |
| "Certificado por vencer" | Certificado digital vence en menos de 30 días | Renovar certificado en Configuración → Firma Digital |
| "Ítems sin cuentas contables" | Productos físicos sin cuenta GL asignada | Ir a Inventario → Editar ítem y asignar cuentas |

---

## XVI. SOPORTE TÉCNICO

Para soporte técnico, reportar incidentes o solicitar asistencia:

- **Correo**: [CORREO DE SOPORTE]
- **Teléfono**: [NÚMERO DE SOPORTE]
- **Horario de atención**: Lunes a Viernes, 8:00 AM – 5:00 PM (hora Venezuela)

Para incidentes que puedan comprometer la integridad de datos fiscales, el proveedor está obligado a notificar al SENIAT en un plazo no mayor de 24 horas, conforme al Artículo 9 de la PA 121.

---

## XII. PORTALES DE AUTOSERVICIO

### 12.1 Portal del Empleado

Permite a los empleados consultar su información laboral sin necesidad de una cuenta en el sistema.

1. Ir a **Nómina → Empleados**
2. Hacer clic en el empleado → botón **Generar Portal**
3. El sistema genera un enlace único con validez de 30 días
4. Compartir el enlace al empleado por correo o WhatsApp

El empleado puede consultar sin iniciar sesión:
- Sus datos personales y laborales
- Sus últimas 12 nóminas con desglose completo
- Sus vacaciones acumuladas y solicitadas
- Su préstamo activo (si tiene) con progreso de pago

### 12.2 Portal del Cliente

Permite a los clientes consultar sus facturas pendientes y su historial de pagos.

1. Ir a **Facturación → Clientes**
2. Hacer clic en el cliente → botón **Generar Portal**
3. El sistema genera un enlace único con validez de 30 días
4. Compartir el enlace al cliente

---

## XIII. GESTIÓN DOCUMENTAL

La vista unificada de documentos permite:
1. Ir a **Documentos** en el menú principal
2. Ver en una sola tabla: facturas emitidas/recibidas y comprobantes de retención
3. Descargar el PDF de cualquier documento con un clic
4. Generar un **enlace seguro de 7 días** para compartir con el auditor del SENIAT sin necesidad de acceso al sistema

---

## XIV. PRESUPUESTOS Y PROYECCIÓN DE FLUJO DE CAJA

### 14.1 Crear un Presupuesto

1. Ir a **Presupuestos → Nuevo Presupuesto**
2. Asignar nombre, año y descripción
3. Agregar líneas por cuenta contable con el monto presupuestado mensual
4. Activar el presupuesto

### 14.2 Ver Ejecución vs Presupuesto

En el detalle del presupuesto, el sistema muestra en tiempo real:
- Monto presupuestado
- Monto ejecutado (tomado del Libro Mayor)
- Variación (%)

### 14.3 Proyección de Flujo de Caja

El widget de **Flujo de Caja** en el dashboard muestra:
- **Vencido**: CxC y CxP ya vencidos sin pagar
- **0–30 días**: vencimientos próximos
- **31–60 días**
- **61–90 días**

---

## XV. VACACIONES (MÓDULO NÓMINA)

1. Ir a **Nómina → Vacaciones**
2. Ver el balance acumulado por empleado (LOTTT Art.190: 15 días + 1 día/año)
3. Para solicitar vacaciones:
   - Hacer clic en **Nueva Solicitud**
   - Seleccionar empleado, fecha de inicio y días solicitados
   - Estado inicial: PENDIENTE
4. El gerente/admin aprueba o rechaza desde **Bandeja de Aprobaciones**
5. Al aprobar: el sistema envía automáticamente el recibo de vacaciones por email al empleado

---

## XVI. SUSCRIPCIÓN Y PLAN

### 16.1 Ver el Estado de la Suscripción

Ir a **Configuración → Suscripción** para ver:
- Plan activo (Individual, Empresa, o Despacho)
- Fecha de vencimiento
- Botón para renovar

### 16.2 Modo Solo Lectura

Si la suscripción vence sin renovar, el sistema entra en **modo solo lectura**:
- Se puede consultar toda la información histórica
- **No** se pueden crear ni modificar registros
- Un banner rojo en el dashboard avisa del estado
- Recibirás recordatorios por email 7 y 3 días antes del vencimiento

### 16.3 Despacho Contable — Gestión de RIFs

Los usuarios con plan Despacho pueden gestionar múltiples empresas cliente:
1. Ir a **Despacho → Mis Clientes**
2. Agregar el RIF de cada empresa gestionada
3. Cambiar entre empresas con el selector en el menú lateral
4. El plan determina la cantidad máxima de RIFs: STARTER (5), PRO (25), UNLIMITED (ilimitado)

---

*ContaFlow v1.0.0 — Manual de Usuario — Providencia Administrativa SNAT/2024/000121*
*Barquisimeto, Estado Lara — Venezuela — 2026*
