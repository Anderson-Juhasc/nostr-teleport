import { useWebSocketImplementation } from 'nostr-tools/pool'
import { Relay } from 'nostr-tools/relay'
import { SimplePool } from 'nostr-tools/pool'
import * as nip19 from 'nostr-tools/nip19'
import * as nip04 from 'nostr-tools/nip04'
import { getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import WebSocket from 'ws'

useWebSocketImplementation(WebSocket)

const relayArray = [
  'wss://relay.damus.io', 
  'wss://nos.lol', 
  'wss://nostr.bitcoiner.social', 
  'wss://offchain.pub',
]

export default class NostrTeleport {
  relays

  #oldAccount
  #newAccount

  constructor(oldPrvKey, newPrvKey, relays = relayArray) {
    this.relays = relays
    
    this.#oldAccount = this.getAccount(oldPrvKey)
    this.#newAccount = this.getAccount(newPrvKey)
  }

  getAccount(prvKey) {
    const nsec = nip19.nsecEncode(hexToBytes(prvKey))
    const pubKey = getPublicKey(prvKey)
    const npub = nip19.npubEncode(pubKey)

    return { prvKey, nsec, pubKey, npub }
  }

  async getMetadata(pubKey) {
    const pool = new SimplePool()

    try {
      const events = await pool.querySync(
        this.relays,
        { kinds: [0], authors: [pubKey] }
      )
      pool.close(this.relays)

      if (events.length > 0) {
        let event = events.reduce((latest, current) => {
          return current.created_at > latest.created_at ? current : latest
        })

        if (event.content === '') {
          return null
        }

        event.content = JSON.parse(event.content)

        return {
          ...event.content,
        }
      }

      return null
    } catch (error) {
      console.error('Failed to retrieve metadata:', error)
    }
  }

  async getContacts(pubKey) {
    const pool = new SimplePool()
    let followings = []

    try {
      const events = await pool.querySync(
        this.relays,
        { kinds: [3], authors: [pubKey] }
      )

      if (events.length > 0 && events[0].kind === 3) {
        let followingsData = events[0].tags
        .filter(tag => tag[0] === 'p')
        .map(tag => tag[1])

        followingsData.forEach(async (pubKey) => {
          let npub = nip19.npubEncode(pubKey)
          followings.push({
            pubKey,
            npub,
          })
        })
      }
      pool.close(this.relays)

      return followings
    } catch (error) {
      console.error('Failed to retrieve followings:', error)
    }
  }

  async getFollowers() {
    const pool = new SimplePool()
    let followers = []

    try {
      let events = await pool.querySync(
        this.relays,
        { kinds: [3], '#p': [this.#oldAccount.pubKey] }
      )

      if (events.length > 0) {
        events = events.filter(
          (obj, index, self) => index === self.findIndex((o) => o.pubkey === obj.pubkey)
        )

        let followersData = []

        events.forEach((item) => {
          if (item.kind === 3) {
            followersData.push(item.pubkey)
          }
        })

        followersData.forEach(async (pubKey) => {
          let npub = nip19.npubEncode(pubKey)
          followers.push({
            pubKey,
            npub,
          })
        })
      }
      pool.close(this.relays)

      return followers
    } catch (error) {
      console.error('Failed to retrieve followers:', error);
    }
  }

  async transferMetadata() {
    const pool = new SimplePool()

    try {
      const oldMetadata = await this.getMetadata(this.#oldAccount.pubKey)

      if (!oldMetadata) {
        console.log("No metadata found for the old account.")
        return
      }
      
      const aboutMessage = `✨ I've teleported! ✨ This account has been transferred to a new dimension!\n` +
                           `You’ll find me now under my new account: nostr:${this.#newAccount.npub}\n` +
                           `Powered by: https://github.com/Anderson-Juhasc/nostr-teleport #NostrTeleport`

      if (oldMetadata.about === aboutMessage) {
        console.log(`This account has already been teleported to: ${this.#newAccount.npub}`)
        return
      }

      const oldAccountEvent = {
        kind: 0,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: JSON.stringify({
          name: oldMetadata.name,
          display_name: oldMetadata.display_name,
          about: aboutMessage
        }),
        //content: ''
      }

      let signedEvent = finalizeEvent(oldAccountEvent, this.#oldAccount.prvKey)
      await Promise.any(pool.publish(this.relays, signedEvent))

      const newAccountEvent = {
        kind: 0,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: JSON.stringify(oldMetadata),
        //content: ''
      }

      signedEvent = finalizeEvent(newAccountEvent, this.#newAccount.prvKey)
      await Promise.any(pool.publish(this.relays, signedEvent))
      console.log("Transfer metadata completed successfully.")
      pool.close(this.relays)
    } catch (error) {
      console.error('Failed to transfer metadata:', error);
    }
  }

  async migrateContacts() {
    const oldContacts = await this.getContacts(this.#oldAccount.pubKey)

    if (!oldContacts.length) {
      console.log("No contacts to migrate.")
      return
    }

    const pool = new SimplePool()

    const newEvent = {
      kind: 3,
      pubkey: this.#newAccount.pubKey,
      created_at: Math.floor(Date.now() / 1000),
      tags: oldContacts.map(contact => ['p', contact.pubKey]),
      //tags: [], // No contacts to follow
      content: ''
    }

    try {
      const signedEvent = finalizeEvent(newEvent, this.#newAccount.prvKey)
      await Promise.any(pool.publish(this.relays, signedEvent))
      console.log("Contact migration completed successfully.")
      pool.close(this.relays)
    } catch (error) {
      console.error(`Failed to publish contact list`, error)
    }
  }

  async notifyContacts() {
  }

  async notifyFollowers() {
  }

  async cleanUpOldAccount() {
  }

  async publishFarewellEvent() {
  }
}
