# 🏓 Ping Pong Online

Tenis de mesa multijugador en tiempo real en el navegador, con **física 3D y el reglamento oficial de la ITTF**. Crea una sala, pasa el **código de 5 letras** (o el enlace) a un amigo y jugáis 1 contra 1 desde cualquier sitio. No hace falta registrarse ni instalar nada.

**▶ Jugar:** https://web1-wabo.github.io/ping-pong-online/

## Modos

| Modo | Descripción |
|---|---|
| **Online: crear sala** | Genera un código (p. ej. `K7QPX`) y un enlace de invitación `?sala=K7QPX`. |
| **Online: unirse** | Escribe el código del amigo o abre su enlace. |
| **Contra la CPU** | Tres niveles de dificultad. |
| **2 jugadores locales** | En el mismo teclado (W/S y ↑/↓) o en una tablet, cada uno en su mitad. |

## Reglamento (ITTF)

- **Mesa reglamentaria:** 2,74 × 1,525 m a 76 cm del suelo, red de 15,25 cm de alto que sobresale 15,25 cm por cada lado, y pelota de 40 mm.
- **Saque:** se lanza la pelota al aire y se golpea desde detrás de la línea de fondo. Debe **botar primero en tu campo y después en el del rival**. Si toca la red y entra, es **let** y se repite.
- **Devolución correcta:** hay que dejar **botar una vez** la pelota en tu campo y mandarla al campo rival. Si la tocas sobre la mesa sin que haya botado (**volea**), pierdes el punto.
- **Se pierde el punto por:** red, bola fuera, bote en tu propio campo, doble bote o no devolver la pelota.
- **Juegos a 11 con 2 de ventaja.** El saque cambia cada 2 puntos y, desde el 10-10, en cada punto. Quien sacó primero en un juego recibe primero en el siguiente.
- **Partido** a 1 juego o al mejor de 3, 5 (formato oficial) o 7 juegos.
- Un árbitro anuncia cada decisión en pantalla: «¡Red!», «¡Fuera!», «Doble bote», «Volea», «Let»…

## Física y golpes

- La pelota se mueve en 3D (con altura): gravedad, bote con un coeficiente de restitución real (0,89), choque con la red, bolas que tocan la cinta y caídas al suelo. La sombra indica la altura.
- **Efectos:** el **liftado** hace que la bola caiga antes y salga rápida tras el bote, el **cortado** la hace flotar y la frena al botar, y el **lateral** la curva.
- **El gesto decide el golpe:** mover la pala hacia la red al golpear da potencia y liftado, moverla hacia atrás da un cortado, y si la bola viene alta puedes rematar. Dónde toca la pala la pelota y el movimiento lateral deciden la dirección.
- Los golpes arriesgados (fuertes, remates, con el borde de la pala o a bolas muy rápidas o muy bajas) fallan más: pueden ir a la red o salir fuera.
- La CPU predice la trayectoria completa (con botes y efecto) y tiene 3 niveles de dificultad.

## Controles

- **Ratón o dedo:** la pala sigue el puntero por tu lado de la mesa: adelante, atrás y a los lados.
- **Teclado:** `WASD` o flechas. Mantén `Espacio` (o el clic) para un golpe fuerte y `C` (o el clic derecho) para cortar.
- **Saque:** mantén `Espacio`, el clic o el dedo para cargar la fuerza (más fuerza = saque más largo) y suelta. Verás la trayectoria prevista.
- `P` / `Esc`: pausa (sin conexión). `M`: silencio.
- **2 jugadores en el mismo teclado:** izquierda `WASD` + `Espacio` (fuerte/saque) + `Q` (cortado); derecha flechas + `Intro` + `Mayús` derecha.

## Cómo funciona el online

GitHub Pages solo sirve archivos estáticos, así que el juego usa **WebRTC peer-to-peer** con [PeerJS](https://peerjs.com/):

1. El anfitrión se registra en el servidor público de señalización de PeerJS con un ID que incluye el código de la sala.
2. El invitado se conecta a ese ID. A partir de ahí, **los datos de la partida van directos entre los dos navegadores**.
3. Se abren dos canales: `ctrl` (fiable y ordenado: saludo, golpes, revancha, ping) y `state` (no ordenado: estado a 60 Hz, para que un paquete perdido no bloquee los siguientes).

### Netcode

Está inspirado en los artículos de [Gaffer on Games sobre física en red](https://gafferongames.com/post/introduction_to_networked_physics/) y en el modelo *host-authoritative* de proyectos P2P con PeerJS:

- **El anfitrión manda:** simula la física y aplica el reglamento a un paso fijo de 120 Hz, y envía instantáneas del estado (posición, velocidad y efecto de la pelota, marcador, fase y decisión del árbitro) a 60 Hz.
- **El invitado predice:** simula la pelota en su navegador, extrapola cada instantánea según la mitad del ping y corrige con suavidad (o salta a la posición correcta con un suavizado visual si la diferencia es grande).
- **Cada jugador decide sus propios golpes:** el invitado detecta los golpes en su pala y se los comunica al anfitrión, que los valida. Cuando el invitado va a perder un punto por no devolver la pelota, el anfitrión espera un instante por si su golpe viene de camino, para que la latencia no le haga perder una bola que en su pantalla sí ha devuelto.
- Se rechazan las instantáneas antiguas o desordenadas usando un número de secuencia, y un contador de golpes evita aplicar estados contradictorios.

## Estructura

```
index.html        Interfaz (menú, sala, partida, overlays)
css/style.css     Estilos (responsive, táctil, modo de movimiento reducido)
js/physics.js     Física 3D, efectos, cálculo de golpes y saques, puntuación
js/net.js         Salas por código sobre PeerJS
js/game.js        Árbitro (reglas), modos, CPU, predicción del invitado, entrada e interfaz
js/render.js      Vista cenital 2.5D (mesa, red, sombras, marcas de bote, palas)
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
