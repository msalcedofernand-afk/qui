# Perfiles

## Normal

Uso diario. No congela aplicaciones ni cambia governor.

## Servidor Minecraft

Modo agresivo. Detiene y suspende candidatos no esenciales, mantiene Crafty/Java/red y usa un heap Java configurado de 1536 MB. El governor todavía no se modifica: `cpuMode` es metadata hasta validar nodos `sysfs` del kernel real.

## Servidor Web

Prioriza Node, Python y nginx con objetivo Java de 256 MB y CPU equilibrada.

## Desarrollo

Mantiene acceso remoto y herramientas sin congelación agresiva.

## Bajo Consumo

Reduce procesos secundarios y usa CPU powersave. No debe usarse durante cargas sostenidas de Minecraft.

## Contrato De Activación

Antes de aplicar un perfil se identifica el estado anterior. Se restauran candidatos del perfil previo, se validan paquetes protegidos, se aplican suspensiones permitidas y se registra un resumen. Salir de Minecraft requiere confirmación porque Minecraft y Crafty se detienen antes de liberar recursos. La restauración exacta de estados individuales todavía requiere el `RootBroker` transaccional.
