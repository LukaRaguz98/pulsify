const MESSAGES = [
  "Pulse is thinking too fast right now... give it a few seconds.",
  "Pulse overheated from too many genius requests.",
  "Easy there... Pulse needs a tiny cooldown.",
  "Pulse is catching its breath... try again in a moment.",
  "Too many signals at once... Pulse needs a reboot.",
  "Pulse is on fire right now... try again shortly.",
  "The AI hamsters are running too fast... slow down a bit.",
  "Pulse reached maximum brain capacity for a moment.",
  "Pulse needs a quick coffee break...",
  "Pulse is generating too much power right now...",
  "The neural ducks need a second to regroup.",
  "Pulse is temporarily out of braincells... please wait.",
  "Too many big brain requests at once...",
  "Pulse is speedrunning intelligence... cooldown required.",
  "Pulse is cooking a little too hard right now...",
]

let index = 0

export function rateLimitMessage(): string {
  const msg = MESSAGES[index % MESSAGES.length]
  index++
  return msg
}
