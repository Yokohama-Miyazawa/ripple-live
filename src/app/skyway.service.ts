import { Injectable } from '@angular/core'
import { BehaviorSubject, of, Subject } from 'rxjs'
import Peer, { SfuRoom } from 'skyway-js'
import { AngularFireDatabase } from '@angular/fire/database'
import { SystemService } from './system.service'

export interface User {
  id: string
  stream: MediaStream
}
export interface LocalMediaState {
  audio: boolean
  video: boolean
  screen: boolean
}

@Injectable({
  providedIn: 'root',
})
export class SkywayService {
  private peer: Peer | null = null
  private room: SfuRoom | null = null
  private ROOM_MODE: 'sfu' | 'mesh' = 'sfu'
  public roomId: string = 'test'
  private localUser?: User
  private users: User[] = []
  public usersSubject = new BehaviorSubject<User[]>([])
  public localState = new BehaviorSubject<LocalMediaState>({ audio: true, video: true, screen: false })
  public isConnected = false
  public localStreamUpdate = new Subject<MediaStream>()
  public focusUpdate = new Subject<MediaStream>()
  private removeScreenStreamShareEventListener: (() => void) | null = null
  public peerUserList: { [key in string]: string } = {}

  constructor(private rdb: AngularFireDatabase, private system: SystemService) {
    this.peer = new Peer({
      key: '9fa5a062-8447-46df-b6aa-86752eec9bd0',
      debug: 0,
      turn: true,
    })
    this.localState.subscribe(state => {
      console.log(state)
      if (!this.localUser) return
      const vt = this.localUser.stream.getVideoTracks()
      if (vt[0]) vt[0].enabled = state.video
      const at = this.localUser.stream.getAudioTracks()
      if (at[0]) at[0].enabled = state.audio
    })
  }

  setLocalStream(stream: MediaStream) {
    this.localUser = {
      id: 'local',
      stream,
    }
  }

  getLocalUser() {
    return this.localUser
  }

  getMediaStream(type: 'audioOnly' | 'webCam' | 'screen'): Promise<MediaStream> {
    switch (type) {
      case 'screen':
        return (
          navigator.mediaDevices
            // @ts-ignore
            .getDisplayMedia({
              audio: false,
              video: {
                width: {
                  max: 1152,
                },
                height: {
                  max: 648,
                },
                frameRate: 10,
              },
            })
        )
      case 'audioOnly':
        return navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        })
      case 'webCam':
        return navigator.mediaDevices.getUserMedia({
          audio: true,
          video: {
            width: {
              min: 320,
              max: 640,
            },
            height: {
              min: 240,
              max: 360,
            },
            frameRate: 10,
          },
        })
    }
  }

  toggleScreenShare() {
    if (this.localState.value.screen) {
      this.exitScreenShare()
    } else {
      this.enterScreenShare()
    }
  }

  async enterScreenShare() {
    if (!this.localUser || !this.room) return
    const currentStream = this.localUser.stream
    currentStream.getTracks().forEach(track => track.stop())
    const screenStream: MediaStream = await this.getMediaStream('screen')
    const audioStream: MediaStream = await this.getMediaStream('audioOnly')
    audioStream.addTrack(screenStream.getVideoTracks()[0])
    const stream = audioStream
    this.localUser.stream = stream
    this.room.replaceStream(stream)
    this.localStreamUpdate.next(stream)
    this.localState.next({
      audio: this.localState.value.audio,
      video: true,
      screen: true,
    })
    const func = () => this.exitScreenShare()
    stream.addEventListener('inactive', func)
    stream.getVideoTracks()[0].addEventListener('ended', func)
    this.removeScreenStreamShareEventListener = () => {
      stream.removeEventListener('inactive', func)
      stream.getVideoTracks()[0].removeEventListener('ended', func)
    }
  }
  async exitScreenShare() {
    console.log('stop caputuring screen')
    if (!this.room || !this.localUser) return
    const screenStream = this.localUser.stream
    screenStream.getTracks().forEach(track => track.stop())
    if (this.removeScreenStreamShareEventListener) {
      this.removeScreenStreamShareEventListener()
      this.removeScreenStreamShareEventListener = null
    }
    const stream = await this.getMediaStream('webCam')
    this.localUser.stream = stream
    this.room.replaceStream(stream)
    this.localStreamUpdate.next(stream)
    this.localState.next({ audio: this.localState.value.audio, video: true, screen: false })
  }

  async join(roomId: string) {
    this.roomId = roomId
    console.log(roomId)
    const localStream = await this.getMediaStream('webCam')
    if (!localStream) return
    this.setLocalStream(localStream)

    if (!this.peer || !this.peer.open || !this.localUser) {
      return
    }
    this.rdb.database.ref(`rooms/${this.system.currentGroup}/${this.peer.id}`).set(this.system.currentName)

    this.room = this.peer.joinRoom(this.roomId, {
      mode: this.ROOM_MODE,
      stream: this.localUser.stream,
    }) as SfuRoom

    if (!this.room) return

    // 自分が参加
    // @ts-ignore
    this.room.once('open', () => {
      this.isConnected = true
      console.log('=== You joined ===')
    })

    // 他人が参加
    this.room.on('peerJoin', peerId => {
      console.log(`=== ${peerId} joined ===`)
    })

    // 他人が参加
    this.room.on('stream', async stream => {
      this.users.push({
        // @ts-ignore
        id: stream.peerId + '',
        // @ts-ignore
        stream,
      })
      this.usersSubject.next(this.users)
      console.log(this.users)
    })

    // 誰かが離脱
    this.room.on('peerLeave', peerId => {
      console.log(`=== ${peerId} left ===`)
      const index = this.users.findIndex(v => v.id === peerId)
      delete this.users[index]
      this.users.splice(index, 1)
      this.usersSubject.next(this.users)
    })

    // 自分が離脱
    this.room.once('close', () => {
      this.isConnected = false
    })

    // 他人からのメッセージ
    this.room.on('data', ({ data, src }) => {
      console.log(`${src}: ${data}`)
    })

    const userDoc = this.rdb.object<{ [key in string]: string }>('users')
    userDoc.update({
      [this.peer.id]: this.system.currentName,
    })
    userDoc.valueChanges().subscribe(users => {
      this.peerUserList = users || {}
    })
    this.rdb.database
      .ref('users/' + this.peer.id)
      .onDisconnect()
      .remove()
    this.rdb.database
      .ref(`rooms/${this.system.currentGroup}/${this.peer.id}`)
      .onDisconnect()
      .remove()
  }
  exitRoom() {
    if (!this.room) {
      console.error('"room" is null')
      return
    }
    this.room.close()
    this.users = []
    this.usersSubject.next(this.users)
    if (!this.peer) {
      console.error('"peer" is null')
      return
    }
    this.rdb.database.ref(`rooms/${this.system.currentGroup}/${this.peer.id}`).remove()
  }

  sendMessage(message: string) {
    if (this.room === null || this.peer === null) return
    this.room.send(message)
    console.log(`${this.peer.id}: ${message}\n`)
  }

  toggleLocalAudio() {
    const status = this.localState.value
    status.audio = !status.audio
    this.localState.next(status)
  }
  toggleLocalVideo() {
    const status = this.localState.value
    status.video = !status.video
    this.localState.next(status)
  }

  setName(name: string) {
    console.log(name)
    this.system.currentName = name
  }
  setClass(cl: number) {
    this.system.currentClass = cl
  }
  setTable(table: number) {
    this.system.currentTable = table
  }
}
