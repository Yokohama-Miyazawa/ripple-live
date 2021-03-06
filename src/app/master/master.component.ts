import { Component, OnInit } from '@angular/core'
import { SystemService, Status } from '../system.service'
import { Subject, BehaviorSubject } from 'rxjs'

@Component({
  selector: 'app-master',
  templateUrl: './master.component.html',
  styleUrls: ['./master.component.scss'],
})
export class MasterComponent implements OnInit {
  public slide: Status['style']['slide'] = 'none'
  public ytlive: Status['style']['ytlive'] = 'full'
  public ytid: string = ''
  public slideid: string = ''
  public tableName: string[] = []
  public tableNameFire: string[] = []
  public membersVisibility: boolean = false
  public slideUrlList: string[] = []
  public pageObjectId: string[] = []
  public slideTitle = ''
  public fixedText = ''
  public slideIndex: BehaviorSubject<number> = new BehaviorSubject(-1)
  public target = { c1: false, c2: false }
  constructor(private system: SystemService) {}

  ngOnInit() {
    this.slideIndex.subscribe(i => {
      if (i % 10 === 0) {
        for (let k = i + 10; k < i + 20; k++) {
          this.fetchSlideUrl(k)
        }
      }
      this.fetchSlideUrl(i).then(url => {
        if (!url) {
          console.error('no thumbnail')
          return
        }
        this.setSlideUrl(url)
      })
    })
    this.system.statusDoc.valueChanges().subscribe(status => {
      if (!status) {
        console.error('unable to get master status')
        this.system.openSnack('全体講義の情報取得に問題があります (r23)')
        return
      }
      this.slide = status.style.slide
      this.ytlive = status.style.ytlive
      this.ytid = status.ytid || ''
      this.tableName = status.table
      this.tableNameFire = [...status.table]
      this.target = status.target
      this.fixedText = status.fixedText
    })
  }
  updateSlideStatus(value: Status['style']['slide']) {
    this.slide = value
    this.system.statusDoc.update({ style: { slide: value, ytlive: this.ytlive } })
  }
  updateYtliveStatus(value: Status['style']['ytlive']) {
    this.ytlive = value
    this.system.statusDoc.update({ style: { slide: this.slide, ytlive: value } })
  }
  updateYoutubeId() {
    this.system.statusDoc.update({ ytid: this.ytid })
  }
  updateFixedText() {
    this.system.statusDoc.update({ fixedText: this.fixedText })
  }
  /**
   * presentationIdからpageObjectIdのリストを取得
   */
  async updateSlideId() {
    try {
      console.log('スライド取得。' + this.slideid)
      this.slideTitle = '取得中...(最大約15秒)'
      const res = await fetch('https://ripple-live.glitch.me/slide?presentationId=' + this.slideid)
      if (!res.ok) throw (await res.json()).error
      const json: { result: string[]; title: string } = await res.json()
      this.pageObjectId = json.result
      this.slideTitle = json.title
      for (let i = 0; i < Math.max(20, this.pageObjectId.length); i++) {
        this.fetchSlideUrl(i)
      }
      this.slideIndex.next(-1)
      this.slideIndex.next(0)
      console.log(json)
    } catch (error) {
      this.system.openSnack('スライドが取得できませんでした')
      this.slideTitle = ''
    }
  }
  /**
   * スライド番号より得たpageObjectIdから、サムネイルURLを取得
   * @param i スライド番号
   */
  async fetchSlideUrl(i: number) {
    if (!this.pageObjectId[i]) return
    if (!this.slideUrlList[i]) {
      try {
        const res = await fetch(
          'https://ripple-live.glitch.me/thumbnail?pageObjectId=' +
            this.pageObjectId[i] +
            '&presentationId=' +
            this.slideid
        )
        if (!res.ok) throw (await res.json()).error
        const json: { result: string } = await res.json()
        this.slideUrlList[i] = json.result
      } catch (error) {
        console.error('')
      }
    }
    return this.slideUrlList[i]
  }
  setSlideUrl(url: string) {
    this.system.statusDoc.update({ slideURL: url })
  }
  updateTableName() {
    this.system.statusDoc.update({ table: this.tableName })
  }
  // https://stackoverflow.com/questions/50139508/input-loses-focus-when-editing-value-using-ngfor-and-ngmodel-angular5
  trackByFn(index: number, item: any) {
    return index
  }
  groupNameChanged() {
    return !this.tableNameFire.every((v, i) => v === this.tableName[i])
  }
  showMembers() {
    this.membersVisibility = true
  }
  hideMembers() {
    this.membersVisibility = false
  }
  headSlide() {
    this.slideIndex.next(0)
  }
  nextSlide() {
    const val = this.slideIndex.value
    if (val < this.pageObjectId.length - 2) {
      this.slideIndex.next(val + 1)
    }
  }
  backSlide() {
    const val = this.slideIndex.value
    if (0 < val) {
      this.slideIndex.next(val - 1)
    }
  }
  tailSlide() {
    this.slideIndex.next(this.pageObjectId.length - 1)
  }
  changeTarget() {
    this.system.statusDoc.update({ target: this.target })
  }
}
