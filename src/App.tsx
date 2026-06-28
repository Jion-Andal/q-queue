import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import { createClient } from '@supabase/supabase-js'
import {
  CheckCircle2,
  CirclePlus,
  Copy,
  Crown,
  Download,
  History,
  QrCode,
  Shuffle,
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
type Skill = 'Advanced' | 'Intermediate' | 'Beginner'
type MatchStatus = 'queued' | 'in-progress' | 'finished'
type SessionTab = 'playerCards' | 'matchQueue' | 'playerTally'

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
  courtNumber: number
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
  courtCount: number
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

const skills: Skill[] = ['Advanced', 'Intermediate', 'Beginner']
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

function ensureGroupCapacity(groups: Group[], playerCount: number) {
  const requiredGroups = Math.max(groups.length, Math.ceil(playerCount / 2), 1)
  const nextGroups = [...groups]

  while (nextGroups.length < requiredGroups) {
    nextGroups.push({
      id: uid('group'),
      name: `Team ${nextGroups.length + 1}`,
      playerIds: [],
    })
  }

  return nextGroups
}

function clampCourtCount(value: number) {
  return Math.min(Math.max(Math.trunc(value) || 1, 1), 12)
}

function assignCourtNumbers(matches: Match[], courtCount: number) {
  const availableCourts = clampCourtCount(courtCount)
  return matches.map((match, index) => ({
    ...match,
    round: index + 1,
    courtNumber: (index % availableCourts) + 1,
  }))
}

function createSession(mode: Mode, groupCount: number, courtCount: number, hostName: string): Session {
  const createdAt = new Date()
  const expiresAt = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000)

  return {
    id: Math.random().toString(36).slice(2, 8).toUpperCase(),
    hostName,
    mode,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    isTerminated: false,
    courtCount: clampCourtCount(courtCount),
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

function createMatchableCompetitors(session: Session) {
  return session.mode === 'singles'
    ? createSinglesCompetitors(session.players)
    : session.groups.filter((group) => group.playerIds.length > 0)
}

function skillScore(skill: Skill) {
  if (skill === 'Advanced') return 3
  if (skill === 'Intermediate') return 2
  return 1
}

function createBalancedDoublesGroups(players: Player[], groups: Group[], shouldShuffle = false) {
  const seededPlayers = players.map((player) => ({
    player,
    seed: shouldShuffle ? Math.random() : 0,
  }))
  const sortedPlayers = seededPlayers
    .sort((left, right) => {
      const skillDelta = skillScore(right.player.skill) - skillScore(left.player.skill)
      if (skillDelta !== 0) return skillDelta
      if (left.seed !== right.seed) return left.seed - right.seed
      return left.player.name.localeCompare(right.player.name)
    })
    .map(({ player }) => player)

  const pairings: string[][] = []
  let left = 0
  let right = sortedPlayers.length - 1

  while (left <= right) {
    if (left === right) {
      pairings.push([sortedPlayers[left].id])
    } else {
      pairings.push([sortedPlayers[left].id, sortedPlayers[right].id])
    }
    left += 1
    right -= 1
  }

  const nextGroups = ensureGroupCapacity(groups, players.length).map((group, index) => ({
    ...group,
    playerIds: pairings[index] ?? [],
  }))

  const groupByPlayerId = new Map<string, string>()
  nextGroups.forEach((group) => {
    group.playerIds.forEach((playerId) => groupByPlayerId.set(playerId, group.id))
  })

  const nextPlayers = players.map((player) => ({
    ...player,
    groupId: groupByPlayerId.get(player.id),
  }))

  return { groups: nextGroups, players: nextPlayers }
}

function autoAssignDoublesPlayer(session: Session, player: Player) {
  const players = [...session.players, player]
  return createBalancedDoublesGroups(players, session.groups)
}

function buildBalancedMatchQueue(groups: Group[], players: Player[], courtCount: number) {
  const playableGroups = groups.filter((group) => group.playerIds.length > 0)
  const playersById = new Map(players.map((player) => [player.id, player]))
  const profiles = new Map(
    playableGroups.map((group) => {
      const groupPlayers = group.playerIds
        .map((playerId) => playersById.get(playerId))
        .filter((player): player is Player => Boolean(player))
      const divisor = Math.max(groupPlayers.length, 1)
      const wins = groupPlayers.reduce((total, player) => total + player.stats.wins, 0) / divisor
      const losses = groupPlayers.reduce((total, player) => total + player.stats.losses, 0) / divisor
      const skill = groupPlayers.reduce((total, player) => total + skillScore(player.skill), 0) / divisor
      const strength = wins * 2 - losses + skill * 3

      return [group.id, { strength, wins, skill }] as const
    }),
  )
  const matches: Match[] = []

  for (let index = 0; index < playableGroups.length; index += 1) {
    for (let opponent = index + 1; opponent < playableGroups.length; opponent += 1) {
      matches.push({
        id: uid('match'),
        round: matches.length + 1,
        courtNumber: 1,
        teamAId: playableGroups[index].id,
        teamBId: playableGroups[opponent].id,
        status: 'queued',
      })
    }
  }

  const sortedMatches = matches
    .map((match, index) => {
      const left = profiles.get(match.teamAId)
      const right = profiles.get(match.teamBId)
      return {
        match,
        originalIndex: index,
        strengthGap: Math.abs((left?.strength ?? 0) - (right?.strength ?? 0)),
        winGap: Math.abs((left?.wins ?? 0) - (right?.wins ?? 0)),
        skillGap: Math.abs((left?.skill ?? 0) - (right?.skill ?? 0)),
      }
    })
    .sort((left, right) => {
      if (left.strengthGap !== right.strengthGap) return left.strengthGap - right.strengthGap
      if (left.winGap !== right.winGap) return left.winGap - right.winGap
      if (left.skillGap !== right.skillGap) return left.skillGap - right.skillGap
      return left.originalIndex - right.originalIndex
    })
    .map(({ match }) => match)

  return assignCourtNumbers(sortedMatches, courtCount)
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

function normalizeSkill(skill: unknown): Skill {
  if (skill === 'Advanced' || skill === 'Beginner') return skill
  return 'Intermediate'
}

function normalizeSession(session: Session): Session {
  const courtCount = clampCourtCount(session.courtCount ?? 1)

  return {
    ...session,
    courtCount,
    matches: assignCourtNumbers(session.matches ?? [], courtCount).map((match, index) => ({
      ...match,
      round: session.matches?.[index]?.round ?? match.round,
      courtNumber: session.matches?.[index]?.courtNumber ?? match.courtNumber,
    })),
    players: session.players.map((player) => ({
      ...player,
      skill: normalizeSkill(player.skill),
    })),
  }
}

function saveLocalSession(session: Session) {
  localStorage.setItem(localSessionKey(session.id), JSON.stringify(session))
}

function readLocalSession(sessionId: string) {
  const value = localStorage.getItem(localSessionKey(sessionId))
  return value ? normalizeSession(JSON.parse(value) as Session) : null
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

  return data?.payload ? normalizeSession(data.payload) : readLocalSession(sessionId)
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

function getMatchStatusLabel(status: MatchStatus) {
  if (status === 'in-progress') return 'In progress'
  if (status === 'finished') return 'Finished'
  return 'Queued'
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath()
  context.moveTo(x + radius, y)
  context.lineTo(x + width - radius, y)
  context.quadraticCurveTo(x + width, y, x + width, y + radius)
  context.lineTo(x + width, y + height - radius)
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  context.lineTo(x + radius, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - radius)
  context.lineTo(x, y + radius)
  context.quadraticCurveTo(x, y, x + radius, y)
  context.closePath()
}

function App() {
  const inviteQrRef = useRef<HTMLCanvasElement | null>(null)
  const params = new URLSearchParams(window.location.search)
  const initialSessionId = params.get('session') ?? ''
  const initialRole = params.get('role') === 'join' ? 'join' : 'host'

  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<'host' | 'join'>(initialRole)
  const [hostName, setHostName] = useState('')
  const [setupMode, setSetupMode] = useState<Mode>('doubles')
  const [initialGroups, setInitialGroups] = useState(4)
  const [initialCourts, setInitialCourts] = useState(2)
  const [sessionIdInput, setSessionIdInput] = useState(initialSessionId)
  const [joinName, setJoinName] = useState('')
  const [joinSkill, setJoinSkill] = useState<Skill>('Intermediate')
  const [joinIcon, setJoinIcon] = useState(cuteIcons[0].icon)
  const [joinedPlayerId, setJoinedPlayerId] = useState('')
  const [notice, setNotice] = useState('')
  const [noticeTone, setNoticeTone] = useState<'info' | 'error'>('info')
  const [sessionCodeError, setSessionCodeError] = useState('')
  const [dbWarning, setDbWarning] = useState('')
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [isAddMatchModalOpen, setIsAddMatchModalOpen] = useState(false)
  const [isMatchHistoryOpen, setIsMatchHistoryOpen] = useState(false)
  const [activeSessionTab, setActiveSessionTab] = useState<SessionTab>(
    initialRole === 'host' ? 'playerCards' : 'matchQueue',
  )
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

    setActiveSessionTab(role === 'host' ? 'playerCards' : 'matchQueue')
  }, [role, sessionId])

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

    const next = createSession(setupMode, initialGroups, initialCourts, hostName.trim())
    setSession(next)
    setRole('host')
    setActiveSessionTab('playerCards')
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
    setActiveSessionTab('matchQueue')
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

    await updateSession((current) => {
      if (current.mode === 'doubles') {
        const assigned = autoAssignDoublesPlayer(current, player)
        return {
          ...current,
          players: assigned.players,
          groups: assigned.groups,
        }
      }

      return {
        ...current,
        players: [...current.players, player],
      }
    })
    localStorage.setItem(localPlayerKey(session.id), player.id)
    setJoinedPlayerId(player.id)
    setJoinName('')
    setJoinIcon(cuteIcons[0].icon)
    setNoticeTone('info')
    setNotice(
      session.mode === 'doubles'
        ? 'You are in the queue. The system assigned you to a team by default.'
        : 'You are in the queue.',
    )
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

  function renameGroup(groupId: string, name: string) {
    const nextName = name.trim()

    if (!nextName) {
      setNoticeTone('error')
      setNotice('Team name cannot be empty.')
      return
    }

    updateSession((current) => ({
      ...current,
      groups: current.groups.map((group) =>
        group.id === groupId ? { ...group, name: nextName } : group,
      ),
    }))
    setNoticeTone('info')
    setNotice('Team name updated.')
  }

  function generateSchedule() {
    updateSession((current) => {
      const competitors = createMatchableCompetitors(current)
      const matches = buildBalancedMatchQueue(competitors, current.players, current.courtCount)
      return {
        ...current,
        matches,
        activeMatchId: matches[0]?.id,
      }
    })
  }

  function reassignDoublesPartners() {
    updateSession((current) => {
      if (current.mode !== 'doubles') return current

      const balanced = createBalancedDoublesGroups(current.players, current.groups, true)
      const matches = buildBalancedMatchQueue(balanced.groups, balanced.players, current.courtCount)
      return {
        ...current,
        players: balanced.players,
        groups: balanced.groups,
        matches,
        activeMatchId: matches[0]?.id,
      }
    })
    setNoticeTone('info')
    setNotice('Doubles partners were reassigned into balanced teams.')
  }

  function addQueuedMatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!session) return

    const formData = new FormData(event.currentTarget)
    const teamAId = String(formData.get('teamAId') ?? '')
    const teamBId = String(formData.get('teamBId') ?? '')
    const competitorIds = new Set(createMatchableCompetitors(session).map((competitor) => competitor.id))

    if (!competitorIds.has(teamAId) || !competitorIds.has(teamBId)) {
      setNoticeTone('error')
      setNotice('Choose two players or teams before adding a game.')
      return
    }

    if (teamAId === teamBId) {
      setNoticeTone('error')
      setNotice('Choose two different players or teams for the game.')
      return
    }

    updateSession((current) => {
      const currentCompetitorIds = new Set(
        createMatchableCompetitors(current).map((competitor) => competitor.id),
      )

      if (!currentCompetitorIds.has(teamAId) || !currentCompetitorIds.has(teamBId)) {
        return current
      }

      const match: Match = {
        id: uid('match'),
        round: current.matches.length + 1,
        courtNumber: (current.matches.length % current.courtCount) + 1,
        teamAId,
        teamBId,
        status: 'queued',
      }
      const matches = [...current.matches, match]

      return {
        ...current,
        matches,
        activeMatchId: current.activeMatchId ?? match.id,
      }
    })
    setNoticeTone('info')
    setNotice('Game added to the match queue.')
    setIsAddMatchModalOpen(false)
  }

  function removeQueuedMatch(matchId: string) {
    updateSession((current) => {
      const match = current.matches.find((item) => item.id === matchId)
      if (!match) return current

      const currentCompetitors = createCompetitorMap(current)
      const loserId = match.winnerId && match.teamAId === match.winnerId ? match.teamBId : match.teamAId
      const winnerPlayers = match.winnerId ? currentCompetitors.get(match.winnerId)?.playerIds ?? [] : []
      const loserPlayers =
        match.status === 'finished' && match.winnerId
          ? currentCompetitors.get(loserId)?.playerIds ?? []
          : []
      const players =
        match.status === 'finished' && match.winnerId
          ? current.players.map((player) => {
              if (winnerPlayers.includes(player.id)) {
                return {
                  ...player,
                  stats: {
                    ...player.stats,
                    played: Math.max(0, player.stats.played - 1),
                    wins: Math.max(0, player.stats.wins - 1),
                  },
                }
              }

              if (loserPlayers.includes(player.id)) {
                return {
                  ...player,
                  stats: {
                    ...player.stats,
                    played: Math.max(0, player.stats.played - 1),
                    losses: Math.max(0, player.stats.losses - 1),
                  },
                }
              }

              return player
            })
          : current.players
      const matches = current.matches
        .filter((item) => item.id !== matchId)
        .map((item, index) => ({ ...item, round: index + 1 }))
      const courtedMatches = assignCourtNumbers(matches, current.courtCount)
      const activeMatchId =
        current.activeMatchId && courtedMatches.some((item) => item.id === current.activeMatchId)
          ? current.activeMatchId
          : courtedMatches.find((item) => item.status === 'in-progress')?.id ??
            courtedMatches.find((item) => item.status === 'queued')?.id

      return {
        ...current,
        players,
        matches: courtedMatches,
        activeMatchId,
      }
    })
    setNoticeTone('info')
    setNotice('Game removed from the match queue.')
  }

  function startMatch(matchId: string, actorCompetitorId?: string) {
    updateSession((current) => {
      const match = current.matches.find((item) => item.id === matchId)
      if (!match || match.status !== 'queued') return current

      const isAssignedMatch =
        !actorCompetitorId ||
        match.teamAId === actorCompetitorId ||
        match.teamBId === actorCompetitorId
      if (!isAssignedMatch) return current

      return {
        ...current,
        matches: current.matches.map((item) =>
          item.id === matchId ? { ...item, status: 'in-progress' as const } : item,
        ),
        activeMatchId: matchId,
      }
    })
  }

  function finishMatch(matchId: string, winnerId: string, actorCompetitorId?: string) {
    updateSession((current) => {
      const match = current.matches.find((item) => item.id === matchId)
      if (!match || match.status === 'finished') return current
      if (winnerId !== match.teamAId && winnerId !== match.teamBId) return current

      const isAssignedMatch =
        !actorCompetitorId ||
        match.teamAId === actorCompetitorId ||
        match.teamBId === actorCompetitorId
      if (!isAssignedMatch) return current

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
      const nextMatch =
        matches.find((item) => item.status === 'in-progress') ??
        matches.find((item) => item.status === 'queued')

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

  function downloadInviteQr() {
    if (!session || !inviteQrRef.current) return

    const canvas = document.createElement('canvas')
    canvas.width = 900
    canvas.height = 1100
    const context = canvas.getContext('2d')
    if (!context) return

    const background = context.createLinearGradient(0, 0, canvas.width, canvas.height)
    background.addColorStop(0, '#eaf8ff')
    background.addColorStop(0.55, '#f7fbff')
    background.addColorStop(1, '#f1e9ff')
    context.fillStyle = background
    context.fillRect(0, 0, canvas.width, canvas.height)

    context.fillStyle = 'rgba(116, 232, 201, 0.38)'
    context.beginPath()
    context.arc(100, 125, 220, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = 'rgba(163, 124, 255, 0.32)'
    context.beginPath()
    context.arc(820, 115, 210, 0, Math.PI * 2)
    context.fill()

    drawRoundedRect(context, 80, 80, 740, 940, 48)
    context.fillStyle = 'rgba(255, 255, 255, 0.9)'
    context.fill()
    context.strokeStyle = 'rgba(24, 33, 83, 0.1)'
    context.lineWidth = 3
    context.stroke()

    context.fillStyle = '#111735'
    context.font = '900 72px Inter, Segoe UI, sans-serif'
    context.textAlign = 'center'
    context.fillText('QueueQ', canvas.width / 2, 202)

    context.fillStyle = '#5e668f'
    context.font = '800 28px Inter, Segoe UI, sans-serif'
    context.fillText('Scan to join this court queue', canvas.width / 2, 295)

    drawRoundedRect(context, 220, 350, 460, 460, 36)
    context.fillStyle = '#ffffff'
    context.fill()
    context.drawImage(inviteQrRef.current, 260, 390, 380, 380)

    context.fillStyle = '#7e86a6'
    context.font = '900 22px Inter, Segoe UI, sans-serif'
    context.fillText('SESSION CODE', canvas.width / 2, 875)
    context.fillStyle = '#111735'
    context.font = '1000 56px Inter, Segoe UI, sans-serif'
    context.fillText(session.id, canvas.width / 2, 942)

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const link = document.createElement('a')
    link.download = `queueq-${session.id}-qr-${timestamp}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  const hostWaitingPlayers =
    session?.mode === 'singles' ? session.players : session?.players.filter((player) => !player.groupId) ?? []
  const displayedMatches = session?.matches.filter((match) => match.status !== 'finished') ?? []
  const finishedMatches = session?.matches.filter((match) => match.status === 'finished') ?? []
  const matchableCompetitors = session ? createMatchableCompetitors(session) : []
  const joinedPlayer = joinedPlayerId ? playerById.get(joinedPlayerId) : undefined
  const joinedGroup =
    session?.mode === 'singles'
      ? joinedPlayer
        ? competitorById.get(joinedPlayer.id)
        : undefined
      : joinedPlayer?.groupId
        ? competitorById.get(joinedPlayer.groupId)
        : undefined
  const joinedCompetitorId = joinedGroup?.id
  const eligibleDoublesTeams = session?.groups.filter((group) => group.playerIds.length > 0) ?? []
  const hasEmptyDoublesTeams = session?.groups.some((group) => group.playerIds.length === 0) ?? false
  const canGenerateMatches = session
    ? session.mode === 'singles'
      ? session.players.length >= 2
      : eligibleDoublesTeams.length >= 2 && !hasEmptyDoublesTeams
    : false
  const generateMatchesReminder =
    session?.mode === 'singles'
      ? 'Add at least 2 players before generating matches.'
      : 'All teams need members before generating matches.'

  return (
    <main className="app-shell">
      {!session && (
        <section className="hero-panel">
          <div className="hero-copy">
            <div className="brand-pill">
              <span className="brand-icon" aria-hidden="true">
                Q
              </span>
              QueueQ
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
      )}

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
                placeholder="e.g. Coach Jion"
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

            <label className="field">
              Available courts
              <input
                min={1}
                max={12}
                type="number"
                value={initialCourts}
                onChange={(event) => setInitialCourts(clampCourtCount(Number(event.target.value)))}
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

          {role === 'join' && joinedPlayerId && activeSessionTab === 'playerCards' && (
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
                    {session.mode === 'doubles' && (
                      <form
                        className="team-name-form"
                        onSubmit={(event) => {
                          event.preventDefault()
                          const formData = new FormData(event.currentTarget)
                          renameGroup(joinedGroup.id, String(formData.get('teamName') ?? ''))
                        }}
                      >
                        <label className="field">
                          Team name
                          <input
                            defaultValue={joinedGroup.name}
                            key={joinedGroup.id}
                            maxLength={36}
                            name="teamName"
                            placeholder="e.g. Team Smash"
                          />
                        </label>
                        <button className="secondary-button" type="submit">
                          Save name
                        </button>
                      </form>
                    )}
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
              <div className="participants-panel">
                <div className="section-title">
                  <Users size={22} />
                  <div>
                    <p className="eyebrow">All participants</p>
                    <h2>{session.players.length} checked in</h2>
                  </div>
                </div>
                {session.players.length === 0 ? (
                  <p className="empty">Players will appear here after joining.</p>
                ) : (
                  <div className="participants-list">
                    {session.players.map((player) => {
                      const teamName =
                        session.mode === 'singles'
                          ? 'Singles player'
                          : player.groupId
                            ? competitorById.get(player.groupId)?.name ?? 'Assigned team'
                            : 'Waiting room'

                      return (
                        <div
                          className={
                            player.id === joinedPlayerId ? 'participant-row current-player' : 'participant-row'
                          }
                          key={player.id}
                        >
                          <div className="player-identity">
                            <span className="player-icon" aria-hidden="true">
                              {player.icon ?? '🐼'}
                            </span>
                            <span>
                              <strong>{player.name}</strong>
                              <small>{player.skill}</small>
                            </span>
                          </div>
                          <span className="participant-team">{teamName}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </section>
          )}

          {role === 'host' && activeSessionTab === 'playerCards' && (
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
                  <QRCodeCanvas ref={inviteQrRef} value={joinUrl} size={180} />
                </div>
                <p className="code">{session.id}</p>
                <div className="invite-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => navigator.clipboard.writeText(joinUrl)}
                  >
                    <Copy size={16} />
                    Copy invite link
                  </button>
                  <button className="secondary-button" type="button" onClick={downloadInviteQr}>
                    <Download size={16} />
                    Download QR
                  </button>
                </div>
                <button className="danger-button" type="button" onClick={requestTerminateSession}>
                  Terminate session
                </button>
              </aside>

              <div className="main-stack">
                {session.mode === 'doubles' && (
                  <div className="toolbar panel">
                    <div className="toolbar-actions">
                      <button className="secondary-button" type="button" onClick={addGroup}>
                        <CirclePlus size={16} />
                        Add team
                      </button>
                      <button
                        className="secondary-button"
                        disabled={session.players.length < 2}
                        type="button"
                        onClick={reassignDoublesPartners}
                      >
                        <Shuffle size={16} />
                        Reassign partners
                      </button>
                    </div>
                  </div>
                )}

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
                                    <select
                                      className="move-player-select"
                                      value={group.id}
                                      onChange={(event) => assignPlayer(player.id, event.target.value)}
                                    >
                                      {session.groups.map((targetGroup) => (
                                        <option
                                          disabled={
                                            targetGroup.id !== group.id &&
                                            targetGroup.playerIds.length >= 2
                                          }
                                          key={targetGroup.id}
                                          value={targetGroup.id}
                                        >
                                          {targetGroup.id === group.id
                                            ? `${targetGroup.name} (current)`
                                            : targetGroup.name}
                                          {targetGroup.id !== group.id &&
                                          targetGroup.playerIds.length >= 2
                                            ? ' (full)'
                                            : ''}
                                        </option>
                                      ))}
                                    </select>
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

          {(role === 'host' || joinedPlayerId) && activeSessionTab !== 'playerCards' && (
          <section className="player-session-stack">
            {activeSessionTab === 'matchQueue' && (
            <div className="panel matches-panel">
              <div className="match-panel-header">
                <div className="section-title">
                  <Trophy size={22} />
                  <div>
                    <p className="eyebrow">Match queue</p>
                    <div className="title-action-row">
                      <h2>{role === 'join' ? 'Upcoming matches' : activeMatch ? 'Now playing' : 'Schedule'}</h2>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => setIsMatchHistoryOpen(true)}
                      >
                        <History size={16} />
                        Match history ({finishedMatches.length})
                      </button>
                    </div>
                  </div>
                </div>
                <div className="queue-actions">
                  {role === 'host' && (
                    <>
                      <button
                        className="primary-button"
                        disabled={!canGenerateMatches}
                        type="button"
                        onClick={generateSchedule}
                      >
                        <Shuffle size={16} />
                        Generate matches
                      </button>
                      <button
                        className="secondary-button"
                        disabled={matchableCompetitors.length < 2}
                        type="button"
                        onClick={() => setIsAddMatchModalOpen(true)}
                      >
                        <CirclePlus size={16} />
                        Add game
                      </button>
                    </>
                  )}
                </div>
              </div>
              {role === 'host' && (
                <p className={canGenerateMatches ? 'toolbar-reminder ready' : 'toolbar-reminder'}>
                  {canGenerateMatches
                    ? 'Ready to generate matches.'
                    : generateMatchesReminder}
                </p>
              )}
              {displayedMatches.length === 0 ? (
                <p className="empty">Waiting for the host to start matching.</p>
              ) : (
                <div className="match-list">
                  {displayedMatches.map((match, index) => {
                    const teamA = competitorById.get(match.teamAId)
                    const teamB = competitorById.get(match.teamBId)
                    const isActive = match.id === session.activeMatchId
                    const isJoinedPlayerMatch =
                      Boolean(joinedCompetitorId) &&
                      (match.teamAId === joinedCompetitorId || match.teamBId === joinedCompetitorId)
                    const canPlayerStartMatch =
                      role === 'join' && isJoinedPlayerMatch && match.status === 'queued'
                    const canPlayerSubmitWinner =
                      role === 'join' && isJoinedPlayerMatch && match.status === 'in-progress'

                    return (
                      <article className={isActive ? 'match-card active' : 'match-card'} key={match.id}>
                        <div className="match-info">
                          <div className="match-labels">
                            <span className="round-label">Game {index + 1}</span>
                            <span className="court-label">Court {match.courtNumber}</span>
                          </div>
                          <strong>
                            {teamA?.name ?? (session.mode === 'singles' ? 'Player A' : 'Team A')} vs{' '}
                            {teamB?.name ?? (session.mode === 'singles' ? 'Player B' : 'Team B')}
                          </strong>
                          <small>{getMatchStatusLabel(match.status)}</small>
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
                            <button
                              className="danger-button"
                              type="button"
                              onClick={() => removeQueuedMatch(match.id)}
                            >
                              Remove game
                            </button>
                          </div>
                        )}
                        {(canPlayerStartMatch || canPlayerSubmitWinner) && (
                          <div className="match-actions player-match-actions">
                            {canPlayerStartMatch && (
                              <button
                                className="primary-button"
                                type="button"
                                onClick={() => startMatch(match.id, joinedCompetitorId)}
                              >
                                Set in-progress
                              </button>
                            )}
                            {canPlayerSubmitWinner && (
                              <>
                                <button
                                  className="win-button"
                                  type="button"
                                  onClick={() => finishMatch(match.id, match.teamAId, joinedCompetitorId)}
                                >
                                  {teamA?.name} won
                                </button>
                                <button
                                  className="win-button"
                                  type="button"
                                  onClick={() => finishMatch(match.id, match.teamBId, joinedCompetitorId)}
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
            )}

            {activeSessionTab === 'playerTally' && (
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
            )}
          </section>
          )}
          {(role === 'host' || joinedPlayerId) && (
            <footer className="session-footer-tabs" aria-label="Session tabs">
              <button
                aria-current={activeSessionTab === 'playerCards' ? 'page' : undefined}
                className={activeSessionTab === 'playerCards' ? 'session-tab active' : 'session-tab'}
                type="button"
                onClick={() => setActiveSessionTab('playerCards')}
              >
                <Users size={20} />
                <span>Player cards</span>
              </button>
              <button
                aria-current={activeSessionTab === 'matchQueue' ? 'page' : undefined}
                className={activeSessionTab === 'matchQueue' ? 'session-tab active' : 'session-tab'}
                type="button"
                onClick={() => setActiveSessionTab('matchQueue')}
              >
                <Trophy size={20} />
                <span>Match Queue</span>
              </button>
              <button
                aria-current={activeSessionTab === 'playerTally' ? 'page' : undefined}
                className={activeSessionTab === 'playerTally' ? 'session-tab active' : 'session-tab'}
                type="button"
                onClick={() => setActiveSessionTab('playerTally')}
              >
                <CheckCircle2 size={20} />
                <span>Player tally</span>
              </button>
            </footer>
          )}
        </section>
      )}
      {isMatchHistoryOpen && session && (
        <div className="modal-backdrop" role="presentation">
          <div
            aria-describedby="match-history-description"
            aria-labelledby="match-history-title"
            aria-modal="true"
            className="confirmation-modal match-history-modal"
            role="dialog"
          >
            <div>
              <p className="eyebrow">Past games</p>
              <h2 id="match-history-title">Match history</h2>
            </div>
            <p id="match-history-description">
              Review completed games, winners, courts, and player details from this session.
            </p>
            {finishedMatches.length === 0 ? (
              <p className="empty">Finished games will appear here after a winner is selected.</p>
            ) : (
              <div className="history-list">
                {finishedMatches.map((match) => {
                  const teamA = competitorById.get(match.teamAId)
                  const teamB = competitorById.get(match.teamBId)
                  const winner = competitorById.get(match.winnerId ?? '')
                  const teamAPlayers = (teamA?.playerIds ?? [])
                    .map((playerId) => playerById.get(playerId))
                    .filter((player): player is Player => Boolean(player))
                  const teamBPlayers = (teamB?.playerIds ?? [])
                    .map((playerId) => playerById.get(playerId))
                    .filter((player): player is Player => Boolean(player))

                  return (
                    <article className="history-card" key={match.id}>
                      <div className="match-labels">
                        <span className="round-label">Game {match.round}</span>
                        <span className="court-label">Court {match.courtNumber}</span>
                      </div>
                      <div className="history-matchup">
                        <strong>
                          {teamA?.name ?? (session.mode === 'singles' ? 'Player A' : 'Team A')} vs{' '}
                          {teamB?.name ?? (session.mode === 'singles' ? 'Player B' : 'Team B')}
                        </strong>
                        <span className="winner">
                          <CheckCircle2 size={15} />
                          {winner?.name ?? 'Winner'} won
                        </span>
                      </div>
                      <div className="history-rosters">
                        <div>
                          <p>{teamA?.name ?? 'Team A'}</p>
                          {teamAPlayers.length === 0 ? (
                            <small>No players listed</small>
                          ) : (
                            teamAPlayers.map((player) => (
                              <span className="history-player" key={player.id}>
                                <span aria-hidden="true">{player.icon ?? '🐼'}</span>
                                {player.name}
                              </span>
                            ))
                          )}
                        </div>
                        <div>
                          <p>{teamB?.name ?? 'Team B'}</p>
                          {teamBPlayers.length === 0 ? (
                            <small>No players listed</small>
                          ) : (
                            teamBPlayers.map((player) => (
                              <span className="history-player" key={player.id}>
                                <span aria-hidden="true">{player.icon ?? '🐼'}</span>
                                {player.name}
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setIsMatchHistoryOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {isAddMatchModalOpen && session && role === 'host' && (
        <div className="modal-backdrop" role="presentation">
          <form
            aria-describedby="add-match-description"
            aria-labelledby="add-match-title"
            aria-modal="true"
            className="confirmation-modal add-match-modal"
            role="dialog"
            onSubmit={addQueuedMatch}
          >
            <div>
              <p className="eyebrow">Optional game</p>
              <h2 id="add-match-title">Add a game</h2>
            </div>
            <p id="add-match-description">
              Pick two players or teams to add a custom game to the match queue.
            </p>
            <div className="add-match-form">
              <label className="field">
                Player / team A
                <select
                  defaultValue={matchableCompetitors[0]?.id ?? ''}
                  disabled={matchableCompetitors.length < 2}
                  name="teamAId"
                >
                  {matchableCompetitors.map((competitor) => (
                    <option key={competitor.id} value={competitor.id}>
                      {competitor.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Player / team B
                <select
                  defaultValue={matchableCompetitors[1]?.id ?? ''}
                  disabled={matchableCompetitors.length < 2}
                  name="teamBId"
                >
                  {matchableCompetitors.map((competitor) => (
                    <option key={competitor.id} value={competitor.id}>
                      {competitor.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setIsAddMatchModalOpen(false)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={matchableCompetitors.length < 2}
                type="submit"
              >
                Add game
              </button>
            </div>
          </form>
        </div>
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
