import { useState } from 'react'
import { Button, Chip, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Textarea, useDisclosure } from '@heroui/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Locales, type LocaleSummary } from '@/api/client'
import { AppShell } from '@/components/AppShell'
import { GlassCard } from '@/components/GlassCard'

export default function LocalesPage() {
  const qc = useQueryClient()
  const list = useQuery<LocaleSummary[]>({ queryKey: ['locales'], queryFn: Locales.list })
  const [locale, setLocale] = useState('zh-CN')
  const importModal = useDisclosure()
  const newLocaleModal = useDisclosure()

  const selected = list.data?.find((item) => item.locale === locale) ?? list.data?.[0]
  const activeLocale = selected?.locale ?? locale

  return (
    <AppShell title="语言包管理" subtitle="导入、导出、启用、删除语言包">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]">
        <GlassCard hoverable={false} className="!p-4">
          <div className="mb-3 px-2 text-[11px] uppercase tracking-[0.2em] text-default-400">语言</div>
          <div className="space-y-1">
            {(list.data ?? []).map((item) => (
              <button
                key={item.locale}
                onClick={() => setLocale(item.locale)}
                className={[
                  'flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-[13.5px] transition',
                  item.locale === activeLocale
                    ? 'bg-primary-500/15 text-primary-500'
                    : 'text-default-600 hover:bg-foreground/5',
                ].join(' ')}
              >
                <span className="font-medium">{item.locale}</span>
                <span className="text-[11px] text-default-400">{item.total_keys} 词条</span>
              </button>
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-2 px-1">
            <Button size="sm" variant="flat" onPress={newLocaleModal.onOpen}>新增语言</Button>
            <Button size="sm" variant="flat" onPress={importModal.onOpen}>导入语言包</Button>
            <a className="block" href={Locales.exportUrl(activeLocale)} download={`${activeLocale}.json`}>
              <Button size="sm" variant="flat" className="w-full">导出当前语言包</Button>
            </a>
            {activeLocale !== 'zh-CN' && (
              <Button
                size="sm"
                variant="flat"
                color="danger"
                onPress={async () => {
                  if (!confirm(`确定删除语言 "${activeLocale}" ?`)) return
                  await Locales.deleteLocale(activeLocale)
                  setLocale('zh-CN')
                  qc.invalidateQueries({ queryKey: ['locales'] })
                }}
              >
                删除当前语言包
              </Button>
            )}
          </div>
        </GlassCard>

        <GlassCard hoverable={false}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[16px] font-semibold">{activeLocale}</div>
              <div className="mt-1 text-[12.5px] text-default-500">{selected?.total_keys ?? 0} 个词条</div>
            </div>
            <Button
              color="primary"
              onPress={async () => {
                const cfg = await fetch('/api/config', { credentials: 'include' }).then((r) => r.json())
                cfg.i18n.locale = activeLocale
                cfg.i18n.enabled = true
                await fetch('/api/config', {
                  method: 'POST',
                  credentials: 'include',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(cfg),
                })
              }}
            >
              启用
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {(selected?.categories ?? []).map((category) => (
              <Chip key={category} size="sm" variant="flat">{category}</Chip>
            ))}
          </div>
        </GlassCard>
      </div>

      <ImportModal
        disc={importModal}
        locale={activeLocale}
        onDone={() => qc.invalidateQueries({ queryKey: ['locales'] })}
      />
      <NewLocaleModal
        disc={newLocaleModal}
        onDone={(name) => {
          qc.invalidateQueries({ queryKey: ['locales'] })
          if (name) setLocale(name)
        }}
      />
    </AppShell>
  )
}

type Disc = ReturnType<typeof useDisclosure>

function ImportModal({ disc, locale, onDone }: { disc: Disc; locale: string; onDone: () => void }) {
  const [text, setText] = useState('')
  const submit = async () => {
    try {
      const json = JSON.parse(text)
      await Locales.importLocale(locale, json)
      setText('')
      disc.onClose()
      onDone()
    } catch (e) {
      alert('JSON 解析失败：' + (e as Error).message)
    }
  }
  return (
    <Modal isOpen={disc.isOpen} onClose={disc.onClose} backdrop="blur" size="2xl">
      <ModalContent>
        <ModalHeader>导入语言包到 {locale}</ModalHeader>
        <ModalBody className="space-y-3">
          <input
            type="file"
            accept="application/json,.json"
            className="text-[12px] text-default-500"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (file) setText(await file.text())
            }}
          />
          <Textarea
            minRows={12}
            value={text}
            onValueChange={setText}
            placeholder='{ "ui": { ... }, "menu": { ... } }'
            variant="bordered"
            classNames={{ input: 'font-mono text-[12px]' }}
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={disc.onClose}>取消</Button>
          <Button color="primary" onPress={submit} isDisabled={!text.trim()}>导入</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

function NewLocaleModal({ disc, onDone }: { disc: Disc; onDone: (name?: string) => void }) {
  const [name, setName] = useState('')
  const submit = async () => {
    const value = name.trim()
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{1,15}$/.test(value)) {
      alert('语言代码格式不合法（如 en-US, ja, fr-FR）')
      return
    }
    await Locales.createLocale(value)
    setName('')
    disc.onClose()
    onDone(value)
  }
  return (
    <Modal isOpen={disc.isOpen} onClose={disc.onClose} backdrop="blur">
      <ModalContent>
        <ModalHeader>新增语言</ModalHeader>
        <ModalBody>
          <Input
            label="语言代码"
            placeholder="例如 en-US"
            value={name}
            onValueChange={setName}
            variant="bordered"
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={disc.onClose}>取消</Button>
          <Button color="primary" onPress={submit}>创建</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
