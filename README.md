# 🏓 Ping Pong Online

Juego de ping pong multijugador en tiempo real que funciona en el navegador. Crea una sala, pasa el **código de 5 letras** (o el enlace) a un amigo y jugáis 1 contra 1 desde cualquier sitio. No hace falta registrarse ni instalar nada.

**▶ Jugar:** https://web1-wabo.github.io/ping-pong-online/

## Modos

| Modo | Descripción |
|---|---|
| **Online: crear sala** | Genera un código (p. ej. `K7QPX`) y un enlace de invitación `?sala=K7QPX`. |
| **Online: unirse** | Escribe el código del amigo o abre su enlace. |
| **Contra la CPU** | Tres niveles de dificultad (la CPU calcula la trayectoria con rebotes y comete errores a propósito). |
| **2 jugadores locales** | En el mismo teclado (W/S y ↑/↓) o en una tablet, cada uno en su mitad. |

## Reglas (tenis de mesa)

- Gana quien llegue a **11 puntos con 2 de ventaja**.
- El **saque cambia cada 2 puntos** y, a partir del **10-10**, en cada punto.
- En la revancha empieza sacando el otro jugador.
- Dónde golpea la pelota en la pala cambia el ángulo (hasta 55°), y mover la pala al golpear le da **efecto**. Cada golpe acelera la pelota un 6 %.

## Controles

- **Ratón o dedo:** la pala sigue el puntero.
- **Teclado:** `W`/`S` o `↑`/`↓`.
- `P` / `Esc`: pausa (solo modos sin conexión). `M`: silenciar.

## Cómo funciona el online

GitHub Pages solo sirve archivos estáticos, así que el juego usa **WebRTC peer-to-peer** con [PeerJS](https://peerjs.com/):

1. El anfitrión se registra en el servidor público de señalización de PeerJS con un ID que incluye el código de la sala.
2. El invitado se conecta a ese ID. A partir de ahí, **los datos de la partida van directos entre los dos navegadores**.
3. Se abren dos canales: `ctrl` (fiable y ordenado: saludo, golpes, revancha, ping) y `state` (no ordenado: estado a 60 Hz, para que un paquete perdido no bloquee los siguientes).

### Netcode

Está inspirado en los artículos de [Gaffer on Games sobre física en red](https://gafferongames.com/post/introduction_to_networked_physics/) y en el modelo *host-authoritative* de proyectos P2P con PeerJS:

- **El anfitrión manda:** simula la física a un paso fijo de 120 Hz y envía instantáneas del estado a 60 Hz.
- **El invitado predice:** simula la pelota en su navegador, extrapola cada instantánea según la mitad del ping y corrige con suavidad (o salta a la posición correcta con un suavizado visual si la diferencia es grande).
- **Cada jugador decide sus propios golpes:** el invitado detecta los golpes en su pala y se los comunica al anfitrión, que los valida. Así la latencia no te hace fallar una pelota que en tu pantalla sí has tocado. Si el mensaje no llega a tiempo, el anfitrión usa su propia detección.
- Se rechazan las instantáneas antiguas o desordenadas usando un número de secuencia, y un contador de golpes evita aplicar estados contradictorios.

## Estructura

```
index.html        Interfaz (menú, sala, partida, overlays)
css/style.css     Estilos (responsive, táctil, modo de movimiento reducido)
js/physics.js     Física y reglas compartidas
js/net.js         Salas por código sobre PeerJS
js/game.js        Bucle, modos, predicción del invitado, entrada e interfaz
js/render.js      Dibujo en canvas (mesa, palas, estela, partículas)
js/audio.js       Sonidos sintetizados con Web Audio
vendor/peerjs.min.js  PeerJS 1.5.5 (licencia MIT)
```

Sin dependencias de compilación: HTML, CSS y JavaScript con módulos ES.

## Desarrollo local

```bash
python3 -m http.server 8080
# abre http://localhost:8080
```

Para probar el online sin internet, arranca un PeerServer local (`npx peer --port 9000`) y abre `http://127.0.0.1:8080/?signal=127.0.0.1:9000` (este parámetro solo funciona en localhost).

## Limitaciones

- Algunas redes muy restrictivas (NAT simétrico, firewalls corporativos) pueden impedir la conexión directa entre navegadores, porque el juego no usa servidor TURN de retransmisión.
- Si el anfitrión deja la pestaña en segundo plano, el navegador ralentiza el juego. Lo mejor es que los dos mantengan la pestaña visible.

## Licencia

MIT
