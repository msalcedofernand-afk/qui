# Estado de implementación

## Cambios aplicados

- Se alineó el entorno de desarrollo con Node.js 22, requerido por `node:sqlite` y `minestat-es`.
- La cola del RootBroker solo entrega operaciones en estado `queued`.
- El claim de operaciones usa una actualización condicional en SQLite para impedir que dos brokers ejecuten el mismo comando.
- Las operaciones caducadas pasan a estado `expired` y no pueden reclamarse ni completarse.
- Android verifica que el claim fue aceptado antes de ejecutar una operación.
- Un perfil no se confirma como activo si alguna acción root falla.
- El estado persistido solo se actualiza después de completar correctamente las acciones del perfil.
- Las suspensiones aplicadas durante una transición fallida se revierten; las suspensiones retiradas del perfil anterior se vuelven a aplicar.
- Android también compensa suspensiones, restauraciones y governor si una orden del RootBroker falla.
- Se añadió `.env.example` con la configuración de servidor, broker, Minecraft, RCON y red.
- Las respuestas JSON, SSE y archivos estáticos incluyen CSP, protección contra framing, `nosniff`, política de referencia y permisos mínimos.
- Se añadió rate limiting en memoria para sesiones y mutaciones por IP/ruta, con limpieza periódica.
- Se añadió `TRUSTED_NETWORK_ONLY=1` para aceptar API, SSE y broker solo desde localhost o Tailscale.

## Verificación

```bash
npm ci
npm test
```

Resultado actual: 3 pruebas correctas, 0 fallos.

## Pendiente

- El APK ya no compila el secreto: lo solicita en el primer arranque y lo guarda con Android Keystore. Falta emparejamiento temporal y tokens revocables.
- Node y Android todavía contienen ejecutores root; el RootBroker debe convertirse en el único ejecutor.
- El rollback actual es compensatorio: no puede reanudar automáticamente una aplicación que solo fue `force-stop` porque esa acción no tiene una operación inversa segura.
- Faltan pruebas de concurrencia reales y rollback transaccional completo en el RootBroker Android.
- El rollback Android todavía depende de que el perfil anterior incluya `freezeApps` y `cpuMode` correctos.
- El servidor sigue escuchando HTTP en `0.0.0.0`; el acceso debe restringirse a localhost/Tailscale o protegerse con TLS.
- Faltan pruebas Android/KernelSU y pruebas de recuperación tras pérdida de red.
- La APK generada es debug firmada para instalación directa; falta configurar una clave release propia y publicar la versión firmada.
- No existen todavía módulos de documentos, firma digital, SMS, Telegram, SSH ni ADB; están solo especificados en los planes.

## Nota de instalación

En entornos Alpine sin permisos de administrador se utilizó un binario local de Node.js 22 para ejecutar las pruebas. En Codespaces normales, el `devcontainer` instala Node.js 22 automáticamente.

También se instaló localmente JDK 21, Gradle 8.9 y Android SDK 35. La compilación Android llega a `processDebugResources`, pero AAPT2 no inicia en este contenedor Alpine/musl; debe compilarse en el devcontainer Ubuntu definido por el proyecto o en un entorno Linux glibc.
