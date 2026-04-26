import { NavLink } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Tooltip } from '@heroui/react'
import { Icons } from './icons'

interface Item { to: string; label: string; Icon: (typeof Icons)[keyof typeof Icons] }

const items: Item[] = [
  { to: '/',         label: '仪表盘', Icon: Icons.Dashboard },
  { to: '/locales',  label: '语言包', Icon: Icons.Locales },
  { to: '/logs',     label: '日志',   Icon: Icons.Logs },
  { to: '/settings', label: '设置',   Icon: Icons.Settings },
]

export function Sidebar() {
  return (
    <aside className="glass m-4 mr-0 flex w-[268px] shrink-0 flex-col p-5">
      {/* Brand */}
      <div className="relative mb-9 flex items-center gap-3 px-1">
        <div className="relative grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-primary-500/30 to-[color:var(--accent-soft)] text-primary-500 ring-1 ring-inset ring-white/10 shadow-[0_4px_20px_var(--brand-glow)]">
          <Icons.Spark className="h-5 w-5 drop-shadow-[0_0_6px_var(--brand-glow)]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="title-grad whitespace-nowrap text-[15.5px] font-semibold leading-none">
            GitHub Desktop Plus
          </div>
          <div className="eyebrow mt-1.5">Control Plane</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-1.5">
        {items.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} end={to === '/'}>
            {({ isActive }) => (
              <motion.div
                whileHover={{ x: 2 }}
                transition={{ type: 'spring', stiffness: 320, damping: 24 }}
                className={[
                  'group relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13.5px] font-medium transition',
                  isActive
                    ? 'bg-gradient-to-r from-primary-500/20 via-primary-500/10 to-transparent text-primary-500'
                    : 'text-default-600 hover:bg-foreground/[0.04] hover:text-foreground',
                ].join(' ')}
              >
                <Icon className={['h-[17px] w-[17px] shrink-0', isActive ? 'opacity-100' : 'opacity-70 group-hover:opacity-100'].join(' ')} />
                <span>{label}</span>
                {isActive && (
                  <motion.span
                    layoutId="nav-bar"
                    className="absolute inset-y-1.5 right-1 w-[3px] rounded-full bg-primary-500 shadow-[0_0_10px_var(--brand-glow)]"
                  />
                )}
              </motion.div>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Status footer */}
      <div className="mt-auto pt-6">
        <Tooltip content="GDP 运行在本机 7788 端口" placement="right">
          <div className="rounded-2xl border border-white/5 bg-content2/40 p-3.5 backdrop-blur">
            <div className="mb-2 flex items-center gap-2 text-[10.5px] uppercase tracking-[0.22em] text-default-500">
              <span className="relative inline-flex h-2 w-2">
                <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/60" />
                <span className="relative inline-block h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.6)]" />
              </span>
              <span>在线</span>
            </div>
            <div className="font-mono text-[11px] leading-tight text-default-500">127.0.0.1<span className="opacity-40">:</span>7788</div>
          </div>
        </Tooltip>
      </div>
    </aside>
  )
}
