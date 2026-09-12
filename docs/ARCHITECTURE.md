# Redmi Control Plane

## Componentes

- `android/`: app nativa, WebView del panel, servicio persistente y puente KernelSU.
- `server/`: API local, SSE, perfiles, métricas, auditoría y monitor Minecraft.
- `web/`: panel responsive compartido por Android y navegador.
- `work/`: scripts de arranque de Crafty y del control plane.

## Flujo de control

1. El panel autentica cada petición con Bearer token.
2. La API valida el perfil y genera un plan de acciones.
3. Actualmente Node aplica las acciones de paquete y Android las reconcilia al recibir `profile.changed` por SSE.
4. `RootHelper` valida otra vez el paquete y solo admite operaciones de una lista cerrada.
5. El monitor publica métricas y auditoría por SSE; el panel conserva sondeo de respaldo.

El servidor no acepta shell arbitrario. El acceso remoto previsto es Tailscale; el puerto HTTP 3000 debe permanecer dentro de la red de confianza.

## Deuda Arquitectónica Controlada

El ejecutor doble es transitorio. La siguiente versión debe convertir la app Android en el único `RootBroker`: Node crea comandos tipados e idempotentes, Android los confirma con resultado y la API no cambia el perfil activo hasta recibir el acuse. Esto elimina carreras y permite que SMS, Telegram, SSH y el panel usen exactamente la misma política.
