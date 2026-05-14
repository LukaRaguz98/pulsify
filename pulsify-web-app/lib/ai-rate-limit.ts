const MESSAGES = [
  "Echo is thinking too fast right now... give it a few seconds.",
  "Echo overheated from too many genius requests.",
  "Easy there... Echo needs a tiny cooldown.",
  "Echo is catching its breath... try again in a moment.",
  "Too many signals at once... Echo needs a reboot.",
  "Echo is on fire right now... try again shortly.",
  "The AI hamsters are running too fast... slow down a bit.",
  "Echo reached maximum brain capacity for a moment.",
  "Echo needs a quick coffee break...",
  "Echo is generating too much power right now...",
  "The neural ducks need a second to regroup.",
  "Echo is temporarily out of braincells... please wait.",
  "Too many big brain requests at once...",
  "Echo is speedrunning intelligence... cooldown required.",
  "Echo is cooking a little too hard right now...",
]

let index = 0

export function rateLimitMessage(): string {
  const msg = MESSAGES[index % MESSAGES.length]
  index++
  return msg
}
