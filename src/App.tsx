import { useCallback, useEffect, useMemo, useState } from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import { createClient } from '@supabase/supabase-js'
import {
  CalendarClock,
  CheckCircle2,
  CirclePlus,
  Copy,
  Crown,
  QrCode,
  Shuffle,
  Swords,
  Trophy,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import './App.css'

const supabase = createClient(
  'https://drrxpsjkkixgphonsgrx.supabase.co',
  'sb_publishable_oCUsYyajTtjq3B59m0Oggw_GG7KXgOX',
)

type Mode = 'singles' | 'doubles'
type Skill = 'Advanced' | 'Moderate' | 'Beginner'
type MatchStatus = 'queued' | 'finished'

type Player = {
  id: string
  name: string
  skill: Skill
  icon?: string
  groupId?: string
  stats: {
    played: number
    wins: number
    losses: number
  }
}

type Group = {
  id: string
  name: string
  playerIds: string[]
}

type Match = {
  id: string
  round: number
  teamAId: string
  teamBId: string
  status: MatchStatus
  winnerId?: string
}

type Session = {
  id: string
  hostName: string
  mode: Mode
  createdAt: string
  expiresAt: string
  isTerminated: boolean
  players: Player[]
  groups: Group[]
  matches: Match[]
  activeMatchId?: string
}

type SessionRow = {
  id: string
  payload: Session
  expires_at: string
}

const skills: Skill[] = ['Advanced', 'Moderate', 'Beginner']
const cuteIcons = [
  { icon: '🐼', label: 'Panda' },
  { icon: '🐱', label: 'Cat' },
  { icon: '🐶', label: 'Dog' },
  { icon: '🐰', label: 'Bunny' },
  { icon: '🦊', label: 'Fox' },
  { icon: '🐻', label: 'Bear' },
  { icon: '🐥', label: 'Chick' },
  { icon: '🐢', label: 'Turtle' },
  { icon: '🦄', label: 'Unicorn' },
  { icon: '🍓', label: 'Strawberry' },
  { icon: '🧁', label: 'Cupcake' },
  { icon: '🌈', label: 'Rainbow' },
  { icon: '⭐', label: 'Star' },
  { icon: '🌸', label: 'Flower' },
  { icon: '⚡', label: 'Spark' },
]
const SESSION_TABLE = 'q_queue_sessions'

function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`
}

function createGroups(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: uid('group'),
    name: `Team ${index + 1}`,
    playerIds: [],
  }))
}

function createSession(mode: Mode, groupCount: number, hostName: string): Session {
  const createdAt = new Date()
  const expiresAt = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000)

  return {
    id: Math.random().toString(36).slice(2, 8).toUpperCase(),
    hostName,
    mode,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    isTerminated: false,
    players: [],
    groups: createGroups(groupCount),
    matches: [],
  }
}

function buildRoundRobin(groups: Group[]) {
  const playableGroups = groups.filter((group) => group.playerIds.length > 0)
  const matches: Match[] = []

  for (let index = 0; index < playableGroups.length; index += 1) {
    for (let opponent = index + 1; opponent < playableGroups.length; opponent += 1) {
      matches.push({
        id: uid('match'),
        round: matches.length + 1,
        teamAId: playableGroups[index].id,
        teamBId: playableGroups[opponent].id,
        status: 'queued',
      })
    }
  }

  return matches
}

function formatRemaining(expiresAt: string) {
  const remaining = new Date(expiresAt).getTime() - Date.now()
  if (remaining <= 0) return 'Expired'

  const hours = Math.floor(remaining / (60 * 60 * 1000))
  const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000))
  return `${hours}h ${minutes}m left`
}

function getJoinUrl(sessionId: string) {
  const url = new URL(window.location.href)
  url.searchParams.set('session', sessionId)
  url.searchParams.set('role', 'join')
  return url.toString()
}

function getHostUrl(sessionId: string) {
  const url = new URL(window.location.href)
  url.searchParams.set('session', sessionId)
  url.searchParams.set('role', 'host')
  return url.toString()
}

function localSessionKey(sessionId: string) {
  return `q-queue-session-${sessionId}`
}

function saveLocalSession(session: Session) {
  localStorage.setItem(localSessionKey(session.id), JSON.stringify(session))
}

function readLocalSession(sessionId: string) {
  const value = localStorage.getItem(localSessionKey(sessionId))
  return value ? (JSON.parse(value) as Session) : null
}

async function loadSession(sessionId: string) {
  const { data, error } = await supabase
    .from(SESSION_TABLE)
    .select('id,payload,expires_at')
    .eq('id', sessionId)
    .maybeSingle<SessionRow>()

  if (error) {
    throw error
  }

  return data?.payload ?? readLocalSession(sessionId)
}

async function persistSession(session: Session) {
  saveLocalSession(session)

  const { error } = await supabase.from(SESSION_TABLE).upsert({
    id: session.id,
    payload: session,
    expires_at: session.expiresAt,
  })

  if (error) {
    throw error
  }
}

function emptyStats() {
  return { played: 0, wins: 0, losses: 0 }
}

function App() {
  const params = new URLSearchParams(window.location.search)
  const initialSessionId = params.get('session') ?? ''
  const initialRole = params.get('role') === 'join' ? 'join' : 'host'

  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<'host' | 'join'>(initialRole)
  const [hostName, setHostName] = useState('')
  const [setupMode, setSetupMode] = useState<Mode>('doubles')
  const [initialGroups, setInitialGroups] = useState(4)
  const [sessionIdInput, setSessionIdInput] = useState(initialSessionId)
  const [joinName, setJoinName] = useState('')
  const [joinSkill, setJoinSkill] = useState<Skill>('Moderate')
  const [joinIcon, setJoinIcon] = useState(cuteIcons[0].icon)
  const [notice, setNotice] = useState('')
  const [noticeTone, setNoticeTone] = useState<'info' | 'error'>('info')
  const [sessionCodeError, setSessionCodeError] = useState('')
  const [dbWarning, setDbWarning] = useState('')
  const [now, setNow] = useState(Date.now())

  const isExpired = session ? new Date(session.expiresAt).getTime() <= now : false
  const isClosed = Boolean(session?.isTerminated || isExpired)
  const activeMatch = session?.matches.find((match) => match.id === session.activeMatchId)
  const joinUrl = session ? getJoinUrl(session.id) : ''
  const sessionId = session?.id

  const groupById = useMemo(() => {
    const map = new Map<string, Group>()
    session?.groups.forEach((group) => map.set(group.id, group))
    return map
  }, [session?.groups])

  const playerById = useMemo(() => {
    const map = new Map<string, Player>()
    session?.players.forEach((player) => map.set(player.id, player))
    return map
  }, [session?.players])

  const updateSession = useCallback(async (recipe: (current: Session) => Session) => {
    if (!session) return

    const next = recipe(session)
    setSession(next)

    try {
      await persistSession(next)
      setDbWarning('')
    } catch (error) {
      setDbWarning(
        error instanceof Error
          ? `Saved locally. Supabase sync needs the ${SESSION_TABLE} table: ${error.message}`
          : 'Saved locally. Supabase sync is not available.',
      )
    }
  }, [session])

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!initialSessionId) return

    loadSession(initialSessionId)
      .then((loaded) => {
        if (loaded) {
          setSession(loaded)
          setSessionIdInput(loaded.id)
          saveLocalSession(loaded)
        } else {
          setSessionCodeError('Session not found yet. Ask the host to confirm the code.')
        }
      })
      .catch((error) => {
        const local = readLocalSession(initialSessionId)
        if (local) {
          setSession(local)
        }
        setDbWarning(
          error instanceof Error
            ? `Could not load from Supabase: ${error.message}`
            : 'Could not load from Supabase.',
        )
      })
  }, [initialSessionId])

  useEffect(() => {
    if (!sessionId) return

    const interval = window.setInterval(async () => {
      try {
        const loaded = await loadSession(sessionId)
        if (loaded) setSession(loaded)
      } catch {
        // Local state remains usable if the Supabase table is not configured yet.
      }
    }, 4_000)

    return () => window.clearInterval(interval)
  }, [sessionId])

  async function startSession() {
    if (!hostName.trim()) {
      setNoticeTone('error')
      setNotice('Add a host username before creating the session.')
      return
    }

    const next = createSession(setupMode, initialGroups, hostName.trim())
    setSession(next)
    setRole('host')
    setNotice('')
    setNoticeTone('info')
    window.history.replaceState(null, '', getHostUrl(next.id))

    try {
      await persistSession(next)
      setDbWarning('')
    } catch (error) {
      setDbWarning(
        error instanceof Error
          ? `Session is ready locally. Create the Supabase table to let QR joiners sync: ${error.message}`
          : 'Session is ready locally. Create the Supabase table to let QR joiners sync.',
      )
    }
  }

  async function openSession() {
    if (!sessionIdInput.trim()) {
      setSession(null)
      setSessionCodeError('Enter a session code to join.')
      return
    }

    const code = sessionIdInput.trim().toUpperCase()
    setRole('join')
    window.history.replaceState(null, '', getJoinUrl(code))

    try {
      const loaded = await loadSession(code)
      if (loaded) {
        setSession(loaded)
        setNotice('')
        setNoticeTone('info')
      } else {
        setSession(null)
        setSessionCodeError('Invalid session code. Check the code and try again.')
      }
    } catch (error) {
      setSession(null)
      setSessionCodeError('Unable to validate that session code. Please try again.')
      setDbWarning(
        error instanceof Error
          ? `Could not reach Supabase: ${error.message}`
          : 'Could not reach Supabase.',
      )
    }
  }

  async function joinSession() {
    if (!session || !joinName.trim() || isClosed) return

    const player: Player = {
      id: uid('player'),
      name: joinName.trim(),
      skill: joinSkill,
      icon: joinIcon,
      stats: emptyStats(),
    }

    await updateSession((current) => ({
      ...current,
      players: [...current.players, player],
    }))
    setJoinName('')
    setJoinIcon(cuteIcons[0].icon)
    setNoticeTone('info')
    setNotice('You are in the queue. The host can now assign you to a team.')
  }

  function assignPlayer(playerId: string, groupId: string) {
    updateSession((current) => ({
      ...current,
      players: current.players.map((player) =>
        player.id === playerId ? { ...player, groupId } : player,
      ),
      groups: current.groups.map((group) => {
        const withoutPlayer = group.playerIds.filter((id) => id !== playerId)
        return group.id === groupId
          ? { ...group, playerIds: [...withoutPlayer, playerId] }
          : { ...group, playerIds: withoutPlayer }
      }),
    }))
  }

  function removePlayerFromGroup(playerId: string) {
    updateSession((current) => ({
      ...current,
      players: current.players.map((player) =>
        player.id === playerId ? { ...player, groupId: undefined } : player,
      ),
      groups: current.groups.map((group) => ({
        ...group,
        playerIds: group.playerIds.filter((id) => id !== playerId),
      })),
    }))
  }

  function addGroup() {
    updateSession((current) => ({
      ...current,
      groups: [
        ...current.groups,
        {
          id: uid('group'),
          name: `Team ${current.groups.length + 1}`,
          playerIds: [],
        },
      ],
    }))
  }

  function removeGroup(groupId: string) {
    updateSession((current) => ({
      ...current,
      players: current.players.map((player) =>
        player.groupId === groupId ? { ...player, groupId: undefined } : player,
      ),
      groups: current.groups.filter((group) => group.id !== groupId),
      matches: current.matches.filter(
        (match) => match.teamAId !== groupId && match.teamBId !== groupId,
      ),
      activeMatchId:
        current.activeMatchId &&
        current.matches.some(
          (match) =>
            match.id === current.activeMatchId &&
            match.teamAId !== groupId &&
            match.teamBId !== groupId,
        )
          ? current.activeMatchId
          : undefined,
    }))
  }

  function swapPlayers(groupId: string, fromIndex: number, toIndex: number) {
    updateSession((current) => ({
      ...current,
      groups: current.groups.map((group) => {
        if (group.id !== groupId) return group
        const playerIds = [...group.playerIds]
        const [playerId] = playerIds.splice(fromIndex, 1)
        playerIds.splice(toIndex, 0, playerId)
        return { ...group, playerIds }
      }),
    }))
  }

  function generateSchedule() {
    updateSession((current) => {
      const matches = buildRoundRobin(current.groups)
      return {
        ...current,
        matches,
        activeMatchId: matches[0]?.id,
      }
    })
  }

  function swapMatch(matchId: string, direction: -1 | 1) {
    updateSession((current) => {
      const matches = [...current.matches]
      const index = matches.findIndex((match) => match.id === matchId)
      const target = index + direction
      if (index < 0 || target < 0 || target >= matches.length) return current

      const currentRound = matches[index].round
      matches[index].round = matches[target].round
      matches[target].round = currentRound
      ;[matches[index], matches[target]] = [matches[target], matches[index]]

      return { ...current, matches }
    })
  }

  function finishMatch(matchId: string, winnerId: string) {
    updateSession((current) => {
      const match = current.matches.find((item) => item.id === matchId)
      if (!match || match.status === 'finished') return current

      const loserId = match.teamAId === winnerId ? match.teamBId : match.teamAId
      const winnerPlayers = groupById.get(winnerId)?.playerIds ?? []
      const loserPlayers = groupById.get(loserId)?.playerIds ?? []

      const players = current.players.map((player) => {
        if (winnerPlayers.includes(player.id)) {
          return {
            ...player,
            stats: {
              played: player.stats.played + 1,
              wins: player.stats.wins + 1,
              losses: player.stats.losses,
            },
          }
        }

        if (loserPlayers.includes(player.id)) {
          return {
            ...player,
            stats: {
              played: player.stats.played + 1,
              wins: player.stats.wins,
              losses: player.stats.losses + 1,
            },
          }
        }

        return player
      })

      const matches = current.matches.map((item) =>
        item.id === matchId ? { ...item, status: 'finished' as const, winnerId } : item,
      )
      const nextMatch = matches.find((item) => item.status === 'queued')

      return {
        ...current,
        players,
        matches,
        activeMatchId: nextMatch?.id,
      }
    })
  }

  async function terminateSession() {
    await updateSession((current) => ({
      ...current,
      isTerminated: true,
    }))
    setSession(null)
    setRole('host')
    setNoticeTone('info')
    setNotice('Session terminated. You can create a new session now.')
    setSessionCodeError('')
    window.history.replaceState(null, '', window.location.pathname)
  }

  const unassignedPlayers = session?.players.filter((player) => !player.groupId) ?? []
  const displayedMatches =
    role === 'join'
      ? session?.matches.filter((match) => match.status === 'queued') ?? []
      : session?.matches ?? []

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <div className="brand-pill">
            <Swords size={18} />
            Q-Queue
          </div>
          <h1>Run fair court rotations without the clipboard chaos.</h1>
          <p>
            Create a 24-hour session, invite players by QR, form teams, and keep wins,
            losses, and games played in one bright match board.
          </p>
        </div>
        <div className="hero-card">
          <div className="orb orb-one" />
          <div className="orb orb-two" />
          <div className="mini-court" aria-hidden="true" />
        </div>
      </section>

      {dbWarning && (
        <div className="notice warning">
          <strong>Supabase note:</strong> {dbWarning}
        </div>
      )}

      {notice && <div className={`notice ${noticeTone}`}>{notice}</div>}

      {!session && (
        <section className="setup-grid">
          <div className="panel setup-panel">
            <div className="section-title">
              <Crown size={22} />
              <div>
                <p className="eyebrow">Host mode</p>
                <h2>Create a session</h2>
              </div>
            </div>

            <label className="field">
              Host username
              <input
                placeholder="e.g. Coach Mia"
                value={hostName}
                onChange={(event) => setHostName(event.target.value)}
              />
            </label>

            <div className="choice-row">
              <button
                className={setupMode === 'singles' ? 'choice active' : 'choice'}
                type="button"
                onClick={() => setSetupMode('singles')}
              >
                Singles
              </button>
              <button
                className={setupMode === 'doubles' ? 'choice active' : 'choice'}
                type="button"
                onClick={() => setSetupMode('doubles')}
              >
                Doubles
              </button>
            </div>

            <label className="field">
              Initial number of teams
              <input
                min={2}
                max={16}
                type="number"
                value={initialGroups}
                onChange={(event) => setInitialGroups(Number(event.target.value))}
              />
            </label>

            <button className="primary-button" type="button" onClick={startSession}>
              Create session
            </button>
          </div>

          <div className="panel setup-panel">
            <div className="section-title">
              <QrCode size={22} />
              <div>
                <p className="eyebrow">Player mode</p>
                <h2>Join by code</h2>
              </div>
            </div>
            <label className="field">
              Session code
              <input
                placeholder="ABC123"
                value={sessionIdInput}
                onChange={(event) => {
                  setSessionIdInput(event.target.value)
                  setSessionCodeError('')
                }}
                aria-invalid={Boolean(sessionCodeError)}
                aria-describedby={sessionCodeError ? 'session-code-error' : undefined}
              />
              {sessionCodeError && (
                <p className="field-error" id="session-code-error">
                  {sessionCodeError}
                </p>
              )}
            </label>
            <button className="secondary-button" type="button" onClick={openSession}>
              Open session
            </button>
          </div>
        </section>
      )}

      {session && (
        <section className="dashboard">
          <header className="session-header">
            <div>
              <p className="eyebrow">Session {session.id}</p>
              <h2>{session.mode === 'doubles' ? 'Doubles' : 'Singles'} round robin</h2>
              <p className="host-name">Hosted by {session.hostName || 'Host'}</p>
            </div>
            <div className="header-actions">
              <span className={isClosed ? 'status closed' : 'status'}>
                <CalendarClock size={16} />
                {session.isTerminated ? 'Terminated' : formatRemaining(session.expiresAt)}
              </span>
            </div>
          </header>

          {role === 'join' && (
            <div className="panel join-panel">
              <div className="section-title">
                <UserPlus size={22} />
                <div>
                  <p className="eyebrow">Player check-in</p>
                  <h2>Tell the host who you are</h2>
                </div>
              </div>
              {isClosed ? (
                <p>This session is closed.</p>
              ) : (
                <div className="join-form">
                  <label className="field">
                    Your name
                    <input
                      placeholder="e.g. Kai"
                      value={joinName}
                      onChange={(event) => setJoinName(event.target.value)}
                    />
                  </label>
                  <label className="field">
                    Skill level
                    <select
                      value={joinSkill}
                      onChange={(event) => setJoinSkill(event.target.value as Skill)}
                    >
                      {skills.map((skill) => (
                        <option key={skill} value={skill}>
                          {skill}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="field icon-picker-field">
                    Choose your icon
                    <div className="icon-picker" role="radiogroup" aria-label="Choose your player icon">
                      {cuteIcons.map((item) => (
                        <button
                          className={joinIcon === item.icon ? 'player-icon-choice active' : 'player-icon-choice'}
                          key={item.label}
                          type="button"
                          role="radio"
                          aria-checked={joinIcon === item.icon}
                          aria-label={item.label}
                          title={item.label}
                          onClick={() => setJoinIcon(item.icon)}
                        >
                          {item.icon}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button className="primary-button" type="button" onClick={joinSession}>
                    Join queue
                  </button>
                </div>
              )}
            </div>
          )}

          {role === 'join' && (
            <section className="panel player-teams-panel">
              <div className="section-title">
                <Users size={22} />
                <div>
                  <p className="eyebrow">Teams</p>
                  <h2>Your session teams</h2>
                </div>
              </div>
              <div className="teams-grid player-teams-grid">
                {session.groups.map((group) => (
                  <article className="team-card" key={group.id}>
                    <div className="team-card-header">
                      <h3>{group.name}</h3>
                    </div>
                    <p className="team-meta">
                      {group.playerIds.length}/{session.mode === 'doubles' ? 2 : 1} players
                    </p>
                    <div className="roster">
                      {group.playerIds.length === 0 && <span className="empty">No players yet</span>}
                      {group.playerIds.map((playerId) => {
                        const player = playerById.get(playerId)
                        if (!player) return null
                        return (
                          <div className="roster-row compact" key={playerId}>
                            <div className="player-identity">
                              <span className="player-icon" aria-hidden="true">
                                {player.icon ?? '🐼'}
                              </span>
                              <span>
                                <strong>{player.name}</strong>
                                <small>{player.skill}</small>
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {role === 'host' && (
            <div className="host-layout">
              <aside className="panel invite-card">
                <div className="section-title">
                  <QrCode size={22} />
                  <div>
                    <p className="eyebrow">Invite players</p>
                    <h2>Scan to join</h2>
                  </div>
                </div>
                <div className="qr-box">
                  <QRCodeCanvas value={joinUrl} size={180} />
                </div>
                <p className="code">{session.id}</p>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => navigator.clipboard.writeText(joinUrl)}
                >
                  <Copy size={16} />
                  Copy invite link
                </button>
                <button className="danger-button" type="button" onClick={terminateSession}>
                  Terminate session
                </button>
              </aside>

              <div className="main-stack">
                <div className="toolbar panel">
                  <button className="secondary-button" type="button" onClick={addGroup}>
                    <CirclePlus size={16} />
                    Add team
                  </button>
                  <button className="primary-button" type="button" onClick={generateSchedule}>
                    <Shuffle size={16} />
                    Generate round robin
                  </button>
                </div>

                {unassignedPlayers.length > 0 && (
                  <div className="panel">
                    <div className="section-title">
                      <Users size={22} />
                      <div>
                        <p className="eyebrow">Waiting room</p>
                        <h2>Assign players</h2>
                      </div>
                    </div>
                    <div className="player-list">
                      {unassignedPlayers.map((player) => (
                        <div className="player-chip" key={player.id}>
                          <div className="player-identity">
                            <span className="player-icon" aria-hidden="true">
                              {player.icon ?? '🐼'}
                            </span>
                            <span>
                              {player.name}
                              <small>{player.skill}</small>
                            </span>
                          </div>
                          <select
                            value=""
                            onChange={(event) => assignPlayer(player.id, event.target.value)}
                          >
                            <option value="" disabled>
                              Send to team
                            </option>
                            {session.groups.map((group) => (
                              <option key={group.id} value={group.id}>
                                {group.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="teams-grid">
                  {session.groups.map((group) => (
                    <article className="team-card" key={group.id}>
                      <div className="team-card-header">
                        <h3>{group.name}</h3>
                        <button
                          className="icon-button"
                          type="button"
                          onClick={() => removeGroup(group.id)}
                          aria-label={`Remove ${group.name}`}
                        >
                          <X size={16} />
                        </button>
                      </div>
                      <p className="team-meta">
                        {group.playerIds.length}/{session.mode === 'doubles' ? 2 : 1} suggested
                      </p>
                      <div className="roster">
                        {group.playerIds.length === 0 && <span className="empty">No players yet</span>}
                        {group.playerIds.map((playerId, index) => {
                          const player = playerById.get(playerId)
                          if (!player) return null
                          return (
                            <div className="roster-row" key={playerId}>
                              <div className="player-identity">
                                <span className="player-icon" aria-hidden="true">
                                  {player.icon ?? '🐼'}
                                </span>
                                <span>
                                  <strong>{player.name}</strong>
                                  <small>{player.skill}</small>
                                </span>
                              </div>
                              <div className="roster-actions">
                                {session.mode === 'doubles' && index > 0 && (
                                  <button
                                    className="tiny-button"
                                    type="button"
                                    onClick={() => swapPlayers(group.id, index, index - 1)}
                                  >
                                    Up
                                  </button>
                                )}
                                <button
                                  className="tiny-button"
                                  type="button"
                                  onClick={() => removePlayerFromGroup(playerId)}
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          )}

          <section className={role === 'join' ? 'player-session-stack' : 'match-and-stats'}>
            <div className="panel matches-panel">
              <div className="section-title">
                <Trophy size={22} />
                <div>
                  <p className="eyebrow">Match queue</p>
                  <h2>{role === 'join' ? 'Upcoming matches' : activeMatch ? 'Now playing' : 'Schedule'}</h2>
                </div>
              </div>
              {displayedMatches.length === 0 ? (
                <p className="empty">
                  {role === 'join'
                    ? 'No upcoming matches yet.'
                    : 'Generate a round robin after teams have players.'}
                </p>
              ) : (
                <div className="match-list">
                  {displayedMatches.map((match, index) => {
                    const teamA = groupById.get(match.teamAId)
                    const teamB = groupById.get(match.teamBId)
                    const isActive = match.id === session.activeMatchId

                    return (
                      <article className={isActive ? 'match-card active' : 'match-card'} key={match.id}>
                        <div className="match-info">
                          <span className="round-label">Game {index + 1}</span>
                          <strong>
                            {teamA?.name ?? 'Team A'} vs {teamB?.name ?? 'Team B'}
                          </strong>
                          <small>{match.status === 'finished' ? 'Finished' : 'Queued'}</small>
                        </div>
                        {role === 'host' && (
                          <div className="match-actions">
                            <button
                              className="tiny-button"
                              type="button"
                              disabled={index === 0}
                              onClick={() => swapMatch(match.id, -1)}
                            >
                              Up
                            </button>
                            <button
                              className="tiny-button"
                              type="button"
                              disabled={index === session.matches.length - 1}
                              onClick={() => swapMatch(match.id, 1)}
                            >
                              Down
                            </button>
                            {match.status !== 'finished' && (
                              <>
                                <button
                                  className="win-button"
                                  type="button"
                                  onClick={() => finishMatch(match.id, match.teamAId)}
                                >
                                  {teamA?.name} won
                                </button>
                                <button
                                  className="win-button"
                                  type="button"
                                  onClick={() => finishMatch(match.id, match.teamBId)}
                                >
                                  {teamB?.name} won
                                </button>
                              </>
                            )}
                          </div>
                        )}
                        {match.status === 'finished' && (
                          <span className="winner">
                            <CheckCircle2 size={15} />
                            {groupById.get(match.winnerId ?? '')?.name} won
                          </span>
                        )}
                      </article>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="panel stats-panel">
              <div className="section-title">
                <Users size={22} />
                <div>
                  <p className="eyebrow">Player tally</p>
                  <h2>Games, wins, losses</h2>
                </div>
              </div>
              <div className="stats-list">
                {session.players.length === 0 && <p className="empty">Players will appear here after joining.</p>}
                {session.players.map((player) => (
                  <div className="stat-row" key={player.id}>
                    <div className="player-identity">
                      <span className="player-icon" aria-hidden="true">
                        {player.icon ?? '🐼'}
                      </span>
                      <span>
                        <strong>{player.name}</strong>
                        <small>{player.skill}</small>
                      </span>
                    </div>
                    <span>{player.stats.played} GP</span>
                    <span>{player.stats.wins} W</span>
                    <span>{player.stats.losses} L</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </section>
      )}
    </main>
  )
}

export default App
