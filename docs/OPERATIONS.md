# Operación

## Direcciones

- Panel local: `http://192.168.18.99:3000`
- Panel Tailscale: `http://100.93.144.107:3000`
- Crafty: `https://100.93.144.107:8443`
- Minecraft: `100.93.144.107:25565`

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
