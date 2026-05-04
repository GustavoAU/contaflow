# Changelog

Todos los cambios a ContaFlow se documentan aquí.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.1.0/).
Versionado basado en [Semantic Versioning](https://semver.org/lang/es/).

## [Unreleased]

### Added
- (Features pendientes de release)

### Changed
- (Cambios pendientes de release)

### Fixed
- (Fixes pendientes de release)

### Security
- (Parches de seguridad pendientes)

---

## [1.0.0] - Por definir

### Added
- Gestión de facturas (SALE/PURCHASE) con número de control automático (Providencia 0071)
- Retenciones IVA/ISLR con comprobante (CR-XXXXXXXX)
- IGTF automático en transacciones de divisas
- Nómina LOTTT: cálculo automático de prestaciones, vacaciones, utilidades
- Reportes fiscales: Declaración IVA, Forma 30, Libro de Compras/Ventas
- Asistente contable IA: Chat + análisis de imágenes (Gemini Vision)
- Wiki de Producto: Procesos, Decisiones, FAQs, Glosario VEN-NIF
- Autenticación multi-tenant con Clerk
- AuditLog inmutable con captura de IP y user-agent (PA 121)
- Conciliación bancaria automática (CSV)
- Módulo de Inventario: múltiples UoM, flujo DRAFT → contabilización, CPP
- Firma digital de documentos fiscales (certificado PKCS#12)

### Security
- IDOR protection en todas las Server Actions (companyId guard)
- Rate limiting en operaciones fiscales (30/min) con Upstash
- Input sanitization contra XSS e inyección
- Soft-delete en entidades fiscales (nunca DELETE)
- AuditLog append-only (ADR-006 D-4)

---

<!-- Links de comparación (actualizar con URLs reales del repo) -->
[Unreleased]: https://github.com/GustavoAU/modern-cg1/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/GustavoAU/modern-cg1/releases/tag/v1.0.0
