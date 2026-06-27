import { useCallback, useEffect, useMemo, useState } from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import { createClient } from '@supabase/supabase-js'
import {
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

type Confirmation = {
  title: string
  message: string
  confirmLabel: string
  action: () => void | Promise<void>
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
    groups: mode === 'doubles' ? createGroups(groupCount) : [],
    matches: [],
  }
}

function createSinglesCompetitors(players: Player[]) {
  return players.map((player) => ({
    id: player.id,
    name: player.name,
    playerIds: [player.id],
  }))
}

function createCompetitorMap(session: Session) {
  const competitors = session.mode === 'singles' ? createSinglesCompetitors(session.players) : session.groups
  return new Map(competitors.map((competitor) => [competitor.id, competitor]))
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

function localPlayerKey(sessionId: string) {
  return `q-queue-player-${sessionId}`
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
  const [joinedPlayerId, setJoinedPlayerId] = useState('')
  const [notice, setNotice] = useState('')
  const [noticeTone, setNoticeTone] = useState<'info' | 'error'>('info')
  const [sessionCodeError, setSessionCodeError] = useState('')
  const [dbWarning, setDbWarning] = useState('')
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [now, setNow] = useState(Date.now())

  const isExpired = session ? new Date(session.expiresAt).getTime() <= now : false
  const isClosed = Boolean(session?.isTerminated || isExpired)
  const activeMatch = session?.matches.find((match) => match.id === session.activeMatchId)
  const joinUrl = session ? getJoinUrl(session.id) : ''
  const sessionId = session?.id

  const playerById = useMemo(() => {
    const map = new Map<string, Player>()
    session?.players.forEach((player) => map.set(player.id, player))
    return map
  }, [session?.players])

  const competitorById = useMemo(() => {
    return session ? createCompetitorMap(session) : new Map<string, Group>()
  }, [session])

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
          setJoinedPlayerId(localStorage.getItem(localPlayerKey(loaded.id)) ?? '')
          saveLocalSession(loaded)
        } else {
          setSessionCodeError('Session not found yet. Ask the host to confirm the code.')
        }
      })
      .catch((error) => {
        const local = readLocalSession(initialSessionId)
        if (local) {
          setSession(local)
          setJoinedPlayerId(localStorage.getItem(localPlayerKey(local.id)) ?? '')
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
    setJoinedPlayerId('')
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
      setJoinedPlayerId('')
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
        setJoinedPlayerId(localStorage.getItem(localPlayerKey(loaded.id)) ?? '')
        setNotice('')
        setNoticeTone('info')
      } else {
        setSession(null)
        setJoinedPlayerId('')
        setSessionCodeError('Invalid session code. Check the code and try again.')
      }
    } catch (error) {
      setSession(null)
      setJoinedPlayerId('')
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
    localStorage.setItem(localPlayerKey(session.id), player.id)
    setJoinedPlayerId(player.id)
    setJoinName('')
    setJoinIcon(cuteIcons[0].icon)
    setNoticeTone('info')
    setNotice('You are in the queue. The host can now assign you to a team.')
  }

  function assignPlayer(playerId: string, groupId: string) {
    const targetGroup = session?.groups.find((group) => group.id === groupId)
    if (
      session?.mode === 'doubles' &&
      targetGroup &&
      !targetGroup.playerIds.includes(playerId) &&
      targetGroup.playerIds.length >= 2
    ) {
      setNoticeTone('error')
      setNotice(`${targetGroup.name} already has 2 players.`)
      return
    }

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

  function requestRemovePlayerFromGroup(player: Player) {
    setConfirmation({
      title: 'Remove player?',
      message: `Remove ${player.name} from their current team? They will go back to the waiting room.`,
      confirmLabel: 'Remove player',
      action: () => removePlayerFromGroup(player.id),
    })
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

  function requestRemoveGroup(group: Group) {
    setConfirmation({
      title: 'Remove team?',
      message: `Remove ${group.name}? Its players will go back to the waiting room and related matches will be removed.`,
      confirmLabel: 'Remove team',
      action: () => removeGroup(group.id),
    })
  }

  function generateSchedule() {
    updateSession((current) => {
      const competitors =
        current.mode === 'singles' ? createSinglesCompetitors(current.players) : current.groups
      const matches = buildRoundRobin(competitors)
      return {
        ...current,
        matches,
        activeMatchId: matches[0]?.id,
      }
    })
  }

  function finishMatch(matchId: string, winnerId: string) {
    updateSession((current) => {
      const match = current.matches.find((item) => item.id === matchId)
      if (!match || match.status === 'finished') return current

      const loserId = match.teamAId === winnerId ? match.teamBId : match.teamAId
      const currentCompetitors = createCompetitorMap(current)
      const winnerPlayers = currentCompetitors.get(winnerId)?.playerIds ?? []
      const loserPlayers = currentCompetitors.get(loserId)?.playerIds ?? []

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
    setJoinedPlayerId('')
    setNoticeTone('info')
    setNotice('Session terminated. You can create a new session now.')
    setSessionCodeError('')
    window.history.replaceState(null, '', window.location.pathname)
  }

  function requestTerminateSession() {
    setConfirmation({
      title: 'Terminate session?',
      message: 'This will close the current session for everyone. You can create a new session after terminating.',
      confirmLabel: 'Terminate session',
      action: terminateSession,
    })
  }

  async function confirmDestructiveAction() {
    const action = confirmation?.action
    setConfirmation(null)
    await action?.()
  }

  const hostWaitingPlayers =
    session?.mode === 'singles' ? session.players : session?.players.filter((player) => !player.groupId) ?? []
  const displayedMatches =
    role === 'join'
      ? session?.matches.filter((match) => match.status === 'queued') ?? []
      : session?.matches ?? []
  const joinedPlayer = joinedPlayerId ? playerById.get(joinedPlayerId) : undefined
  const joinedGroup =
    session?.mode === 'singles'
      ? joinedPlayer
        ? competitorById.get(joinedPlayer.id)
        : undefined
      : joinedPlayer?.groupId
        ? competitorById.get(joinedPlayer.groupId)
        : undefined

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

            {setupMode === 'doubles' && (
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
            )}

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
          </header>

          {role === 'join' && !joinedPlayerId && (
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

          {role === 'join' && joinedPlayerId && (
            <section className="panel player-teams-panel">
              <div className="section-title">
                <Users size={22} />
                <div>
                  <p className="eyebrow">{session.mode === 'singles' ? 'Your player card' : 'Your team'}</p>
                  <h2>{joinedGroup ? joinedGroup.name : 'Waiting for assignment'}</h2>
                </div>
              </div>
              {!joinedPlayer ? (
                <p className="empty">You are checked in. Waiting for the host to sync your player card.</p>
              ) : !joinedGroup ? (
                <div className="waiting-card">
                  <div className="player-identity">
                    <span className="player-icon" aria-hidden="true">
                      {joinedPlayer.icon ?? '🐼'}
                    </span>
                    <span>
                      <strong>{joinedPlayer.name}</strong>
                      <small>{joinedPlayer.skill}</small>
                    </span>
                  </div>
                  <p>
                    {session.mode === 'singles'
                      ? 'You are checked in and ready for singles scheduling.'
                      : 'The host will assign you to a team soon.'}
                  </p>
                </div>
              ) : (
                <div className="teams-grid player-teams-grid">
                  <article className="team-card" key={joinedGroup.id}>
                    <div className="team-card-header">
                      <h3>{joinedGroup.name}</h3>
                    </div>
                    <p className="team-meta">
                      {session.mode === 'singles'
                        ? 'Singles competitor'
                        : `${joinedGroup.playerIds.length}/2 players`}
                    </p>
                    <div className="roster">
                      {joinedGroup.playerIds.map((playerId) => {
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
                </div>
              )}
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
                <button className="danger-button" type="button" onClick={requestTerminateSession}>
                  Terminate session
                </button>
              </aside>

              <div className="main-stack">
                <div className="toolbar panel">
                  {session.mode === 'doubles' && (
                    <button className="secondary-button" type="button" onClick={addGroup}>
                      <CirclePlus size={16} />
                      Add team
                    </button>
                  )}
                  <button className="primary-button" type="button" onClick={generateSchedule}>
                    <Shuffle size={16} />
                    Generate round robin
                  </button>
                </div>

                {hostWaitingPlayers.length > 0 && (
                  <div className="panel">
                    <div className="section-title">
                      <Users size={22} />
                      <div>
                        <p className="eyebrow">
                          {session.mode === 'singles' ? 'Singles players' : 'Waiting room'}
                        </p>
                        <h2>{session.mode === 'singles' ? 'Checked-in players' : 'Assign players'}</h2>
                      </div>
                    </div>
                    <div className="player-list">
                      {hostWaitingPlayers.map((player) => (
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
                          {session.mode === 'doubles' && (
                            <select
                              value=""
                              onChange={(event) => assignPlayer(player.id, event.target.value)}
                            >
                              <option value="" disabled>
                                Send to team
                              </option>
                              {session.groups.map((group) => (
                                <option
                                  disabled={group.playerIds.length >= 2}
                                  key={group.id}
                                  value={group.id}
                                >
                                  {group.name}
                                  {group.playerIds.length >= 2 ? ' (full)' : ''}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {session.mode === 'doubles' && (
                  <div className="teams-grid">
                    {session.groups.map((group) => (
                      <details className="team-card team-accordion" key={group.id}>
                        <summary className="team-summary">
                          <span>{group.name}</span>
                          <span className="team-count">
                            {group.playerIds.length}/2 players
                            {group.playerIds.length >= 2 ? ' - full' : ''}
                          </span>
                        </summary>
                        <div className="team-details">
                          <button
                            className="danger-button"
                            type="button"
                            onClick={() => requestRemoveGroup(group)}
                          >
                            Remove {group.name}
                          </button>
                          <div className="roster">
                            {group.playerIds.length === 0 && <span className="empty">No players yet</span>}
                            {group.playerIds.map((playerId) => {
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
                                    <button
                                      className="tiny-button"
                                      type="button"
                                      onClick={() => requestRemovePlayerFromGroup(player)}
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      </details>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {(role === 'host' || joinedPlayerId) && (
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
                    const teamA = competitorById.get(match.teamAId)
                    const teamB = competitorById.get(match.teamBId)
                    const isActive = match.id === session.activeMatchId

                    return (
                      <article className={isActive ? 'match-card active' : 'match-card'} key={match.id}>
                        <div className="match-info">
                          <span className="round-label">Game {index + 1}</span>
                          <strong>
                            {teamA?.name ?? (session.mode === 'singles' ? 'Player A' : 'Team A')} vs{' '}
                            {teamB?.name ?? (session.mode === 'singles' ? 'Player B' : 'Team B')}
                          </strong>
                          <small>{match.status === 'finished' ? 'Finished' : 'Queued'}</small>
                        </div>
                        {role === 'host' && (
                          <div className="match-actions">
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
                            {competitorById.get(match.winnerId ?? '')?.name} won
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
                    <div className="stat-pills">
                      <span className="stat-pill games">{player.stats.played} Games</span>
                      <span className="stat-pill wins">{player.stats.wins} W</span>
                      <span className="stat-pill losses">{player.stats.losses} L</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
          )}
        </section>
      )}
      {confirmation && (
        <div className="modal-backdrop" role="presentation">
          <div
            aria-describedby="confirmation-message"
            aria-labelledby="confirmation-title"
            aria-modal="true"
            className="confirmation-modal"
            role="dialog"
          >
            <div>
              <p className="eyebrow">Please confirm</p>
              <h2 id="confirmation-title">{confirmation.title}</h2>
            </div>
            <p id="confirmation-message">{confirmation.message}</p>
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setConfirmation(null)}
              >
                Cancel
              </button>
              <button className="danger-button" type="button" onClick={confirmDestructiveAction}>
                {confirmation.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

export default App
