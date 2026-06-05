'use client'

import { useState } from 'react'

/** Round staff avatar with a graceful initials fallback (broken/no image). */
export function StaffAvatar({
  name,
  avatar,
  size = 32,
}: {
  name: string
  avatar: string | null
  size?: number
}) {
  const [failed, setFailed] = useState(false)
  const initials = name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || '?'

  if (!avatar || failed) {
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-full font-semibold"
        style={{
          width: size,
          height: size,
          background: 'var(--p-soft)',
          color: 'var(--p-1)',
          fontSize: size * 0.36,
        }}
      >
        {initials}
      </span>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={avatar}
      alt={name}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className="shrink-0 rounded-full object-cover"
      style={{ width: size, height: size }}
    />
  )
}
