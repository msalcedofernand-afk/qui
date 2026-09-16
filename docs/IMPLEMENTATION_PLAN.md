# Plan de implementación

## Objetivo

Panel privado para administrar el Redmi y el servidor Minecraft Paper. El panel será accesible por Wi‑Fi local y, de forma remota, únicamente mediante Tailscale.

## 1. Navegación del panel

- Mantener una barra horizontal en la cabecera.
- Mostrar una sola pantalla cada vez.
- Secciones: Resumen, Estado, Operación, Terminal Minecraft, Acceso y Auditoría.
- Mantener diseño responsive para móvil.

## 2. Acceso de red

- Permitir acceso local solo desde la subred Wi‑Fi configurada.
- Permitir acceso remoto solo desde la interfaz Tailscale.
- Rechazar peticiones desde interfaces públicas o desconocidas.
- Mantener sesión autenticada, CSRF y rate limiting.
- No publicar el puerto directamente en Internet.

Configuración prevista:

```env
LAN_CIDR=192.168.1.0/24
TAILSCALE_INTERFACE=tailscale0
ALLOW_TAILSCALE=1
```

## 3. Terminal Minecraft

- La terminal será exclusiva de Paper/Minecraft.
- No ejecutará comandos shell, Android ni root.
- Node.js será el intermediario entre el navegador y RCON.
- Mostrar logs y respuestas en tiempo real.
- Permitir comandos como `list`, `save-all`, `whitelist` y `op`.
- Enviar comandos con botón o tecla Enter.
- Mostrar errores, timeout y estado del servidor.
- No exponer la contraseña RCON al navegador.

Flujo:

```text
Navegador → Node.js autenticado → RCON local → Paper
```

## 4. Operaciones del dispositivo

- Mantener las operaciones root fuera de la terminal.
- Android/RootBroker será el único ejecutor root.
- Implementar estados `queued`, `running`, `succeeded`, `failed` y `expired`.
- Completar rollback de perfiles si una acción falla.
- Probar cambios Normal/Minecraft en el Redmi real.

## 5. Minecraft y Crafty

- Iniciar y detener Minecraft desde Operación.
- Mostrar estado real después de reinicios.
- Detectar dirección LAN, Tailscale y puerto del servidor.
- Controlar errores de RCON y pérdida de conexión.
- Evitar guardar contraseñas o respuestas sensibles en auditoría.

## 6. Recuperación

- Reiniciar servicios después de reiniciar Android.
- Reconectar tras pérdida de Wi‑Fi o Tailscale.
- Mantener procesos del servidor durante una desconexión del navegador.
- Añadir acción de emergencia para detener Minecraft.
- Documentar backup y restauración de SQLite.

## 7. Seguridad pendiente

- Migrar el secreto del APK a Android Keystore.
- Implementar emparejamiento temporal del dispositivo.
- Restringir el servidor a LAN/Tailscale.
- Añadir expiración y revocación del acceso personal.
- Ocultar detalles internos en errores de producción.

## 8. Pruebas finales

1. Acceso desde la misma Wi‑Fi.
2. Bloqueo desde una red externa.
3. Acceso remoto mediante Tailscale.
4. Comandos RCON cortos y largos.
5. Servidor apagado y reiniciado.
6. Pérdida de conexión durante un comando.
7. Cambio de perfiles con éxito y con error.
8. Reinicio del Redmi y recuperación automática.

## Orden recomendado

`red → RCON/terminal → RootBroker → rollback → secretos → recuperación → pruebas finales`
