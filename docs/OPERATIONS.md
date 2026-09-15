# Operación

## Direcciones

Las direcciones no deben fijarse en la documentación: el panel las detecta en cada actualización desde las interfaces de red disponibles.

- Panel local: `http://<IP-LAN>:3000`
- Panel Tailscale: `http://<IP-TAILSCALE>:3000`
- Crafty: `https://<IP-TAILSCALE-o-IP-LAN>:8443`
- Minecraft: `<IP anunciada>:<MC_PORT>` (por defecto `25565`)

La API `GET /api/stats/live` devuelve `network.lan`, `network.tailscale` y `minecraft.host`. `PUBLIC_HOST` puede establecer explícitamente el host anunciado; si no existe, se prioriza Tailscale y después la LAN.

## Verificación

```text
GET /api/stats/live
GET /api/minecraft/status
GET /api/profiles/minecraft/plan
GET /api/audit
```

Minecraft se considera online cuando responde el puerto 25565. Si existe Java pero el puerto aún no abre, se muestra `starting`; Crafty se comprueba por su puerto 8443. El conteo real de jugadores requiere implementar el ping de protocolo Minecraft.

## Cambios Permitidos

No se desinstalan paquetes, no se modifican particiones y no se suspenden componentes protegidos. Antes de habilitar SMS, hotspot o ADB remoto se debe registrar el permiso y probar recuperación local.
