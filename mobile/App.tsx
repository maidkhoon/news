import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { getAvailablePurchases, useIAP } from 'expo-iap'
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Image,
  Linking,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  Platform,
} from 'react-native'
import type { Session } from '@supabase/supabase-js'
import { supabase, supabaseConfigError } from './lib/supabase'

type AuthStep = 'phone' | 'otp'
type Category = { id: string; name: string; slug: string }
type Article = {
  id: string
  title: string
  slug: string
  image_url?: string | null
  source_url?: string | null
  source_name?: string | null
  access_type?: string
  status?: string
  published_at?: string | null
  content?: string
  categories?: { name?: string; slug?: string } | null
}
type Tab = 'Home' | 'Crypto' | 'NSE' | 'BSE' | 'Cricket'
type AppScreen = 'home' | 'plans' | 'payment' | 'notifications' | 'saved' | 'auth'
type NewsNotification = { id: string; title: string; message: string; article_id?: string | null; created_at: string; articles?: { slug?: string } | null }
type Subscription = { id: string; plan_type: string; product_id?: string; status: string; expiry_date: string; auto_renewing: boolean }
type MarketStock = { symbol: string; name: string; exchange: 'NSE' | 'BSE'; price: number; change: number | null; percentChange: number; volume: number | null; dataTimestamp: string | null }
type MarketMovers = { exchange: 'NSE' | 'BSE'; count: number; gainers: MarketStock[]; losers: MarketStock[]; fetchedAt: string; dataTimestamp: string | null; cached: boolean }
type TickerItem = { kind: 'crypto' | 'stock'; symbol: string; name: string; price: number; percentChange: number | null; currency: string; exchange: 'NSE' | 'BSE' | null; dataTimestamp: string | null }
type MarketTicker = { items: TickerItem[]; fetchedAt: string; refreshSeconds: number; cached: boolean }

const SAVED_STORAGE_KEY = 'bazaarnexa:saved-article-ids'
const TOPICS_STORAGE_KEY = 'bazaarnexa:briefing-topics'
const DEFAULT_TOPICS = ['India', 'Crypto', 'Cricket']
const PLAY_PRODUCTS = {
  BASIC_MONTHLY: process.env.EXPO_PUBLIC_GOOGLE_PLAY_BASIC_MONTHLY_PRODUCT_ID || '',
  BASIC_YEARLY: process.env.EXPO_PUBLIC_GOOGLE_PLAY_BASIC_YEARLY_PRODUCT_ID || '',
  PRO_MONTHLY: process.env.EXPO_PUBLIC_GOOGLE_PLAY_PRO_MONTHLY_PRODUCT_ID || '',
  PRO_YEARLY: process.env.EXPO_PUBLIC_GOOGLE_PLAY_PRO_YEARLY_PRODUCT_ID || '',
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL || 'https://news-api-egmd.onrender.com').replace(/\/$/, '')
const NAV_TABS: Tab[] = ['Home', 'Crypto', 'NSE', 'BSE', 'Cricket']
const NAV_ICONS = ['⌂', '₿', '↗', '▥', '🏏']
const FILTERS = ['All', 'India', 'Nifty 50', 'Sensex', 'Crypto', 'Cricket']

// Classifies Supabase auth errors so network, rate-limit, and WhatsApp provider
// failures show distinct, actionable messages instead of a raw stack trace.
function describeAuthError(error: unknown): string {
  if (!(error instanceof Error)) return 'Please try again.'
  const message = error.message || ''
  const status = (error as { status?: number }).status
  if (/UnknownHostException|Unable to resolve host|ENOTFOUND|Network request failed|fetch failed/i.test(message)) {
    return 'No internet connection reached BazaarNexa. Check your Wi-Fi or mobile data and try again.'
  }
  if (status === 429 || /rate limit|too many/i.test(message)) {
    return 'Too many attempts. Please wait a minute before requesting another OTP.'
  }
  if (/whatsapp|sms|twilio|provider|message delivery/i.test(message)) {
    return 'WhatsApp OTP delivery failed. Check the Supabase Phone provider and Twilio WhatsApp configuration, then try again.'
  }
  return message || 'Please try again.'
}

function readableDate(value?: string | null) {
  if (!value) return 'Latest research'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Latest research'
  const delta = Math.max(0, Date.now() - date.getTime())
  if (delta < 60 * 60 * 1000) return `${Math.max(1, Math.floor(delta / 60000))} min ago`
  if (delta < 24 * 60 * 60 * 1000) return `${Math.floor(delta / 3600000)} hours ago`
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [initializing, setInitializing] = useState(true)
  const [step, setStep] = useState<AuthStep>('phone')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [categories, setCategories] = useState<Category[]>([])
  const [articles, setArticles] = useState<Article[]>([])
  const [page, setPage] = useState(1)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [feedLoading, setFeedLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [feedError, setFeedError] = useState('')
  const [marketMovers, setMarketMovers] = useState<MarketMovers | null>(null)
  const [marketLoading, setMarketLoading] = useState(false)
  const [marketError, setMarketError] = useState('')
  const [marketView, setMarketView] = useState<'gainers' | 'losers'>('gainers')
  const [ticker, setTicker] = useState<MarketTicker | null>(null)
  const tickerScrollRef = useRef<ScrollView | null>(null)
  const [tickerContentWidth, setTickerContentWidth] = useState(0)
  const [filter, setFilter] = useState('All')
  const [tab, setTab] = useState<Tab>('Home')
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null)
  const [savedIds, setSavedIds] = useState<string[]>([])
  const [savedLoaded, setSavedLoaded] = useState(false)
  const [briefingTopics, setBriefingTopics] = useState<string[]>(DEFAULT_TOPICS)
  const [briefingSummary, setBriefingSummary] = useState<{ bullets: string[]; keyTerms: { term: string; explanation: string }[]; sourceUrl?: string; sourceName?: string } | null>(null)
  const [briefingLoading, setBriefingLoading] = useState(false)
  const [briefingError, setBriefingError] = useState('')
  const [relatedStories, setRelatedStories] = useState<Article[]>([])
  const [relatedLoading, setRelatedLoading] = useState(false)
  const [screen, setScreen] = useState<AppScreen>('home')
  const [notificationItems, setNotificationItems] = useState<NewsNotification[]>([])
  const [notificationsLoading, setNotificationsLoading] = useState(false)
  const [activeSubscription, setActiveSubscription] = useState<Subscription | null>(null)
  const [planCycle, setPlanCycle] = useState<'monthly' | 'yearly'>('monthly')
  const [chosenPlan, setChosenPlan] = useState<'BASIC' | 'PRO'>('BASIC')
  const finishTransactionRef = useRef<((args: any) => Promise<any>) | null>(null)

  useEffect(() => {
    AsyncStorage.getItem(TOPICS_STORAGE_KEY).then(value => {
      if (value) {
        const parsed = JSON.parse(value)
        if (Array.isArray(parsed)) setBriefingTopics(parsed.filter(topic => typeof topic === 'string'))
      }
    }).catch(() => undefined)

    AsyncStorage.getItem(SAVED_STORAGE_KEY).then(value => {
      if (value) {
        const parsed = JSON.parse(value)
        if (Array.isArray(parsed)) setSavedIds(parsed.filter(id => typeof id === 'string'))
      }
    }).catch(() => undefined).finally(() => setSavedLoaded(true))

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setInitializing(false)
    }).catch(() => setInitializing(false))

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })
    return () => subscription.unsubscribe()
  }, [])

  const normalizedPhone = () => {
    const digits = phone.replace(/\D/g, '')
    if (digits.length !== 10) throw new Error('Enter a valid 10-digit mobile number.')
    return `+91${digits}`
  }

  const sendOtp = async () => {
    if (authLoading || resendCooldown > 0) return
    try {
      setAuthLoading(true)
      const formattedPhone = normalizedPhone()
      const { error } = await supabase.auth.signInWithOtp({ phone: formattedPhone, options: { channel: 'whatsapp' } })
      if (error) throw error
      setStep('otp')
      setOtp('')
      setResendCooldown(30)
      Alert.alert('WhatsApp OTP requested', `Check WhatsApp on ${formattedPhone} for your 6-digit code. If it does not arrive, verify WhatsApp is configured in Supabase Auth.`)
    } catch (error) {
      Alert.alert('Unable to send OTP', describeAuthError(error))
    } finally {
      setAuthLoading(false)
    }
  }

  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = setInterval(() => setResendCooldown(seconds => Math.max(0, seconds - 1)), 1000)
    return () => clearInterval(timer)
  }, [resendCooldown])

  const verifyOtp = async () => {
    try {
      setAuthLoading(true)
      const formattedPhone = normalizedPhone()
      if (!/^\d{6}$/.test(otp)) throw new Error('Enter the 6-digit OTP.')
      const { error } = await supabase.auth.verifyOtp({ phone: formattedPhone, token: otp, type: 'sms' })
      if (error) throw error
      setScreen('home')
    } catch (error) {
      Alert.alert('OTP verification failed', describeAuthError(error))
    } finally {
      setAuthLoading(false)
    }
  }

  // Guests can browse freely; this only opens the optional sign-in screen.
  const openSignIn = useCallback(() => {
    setStep('phone')
    setOtp('')
    setResendCooldown(0)
    setScreen('auth')
  }, [])

  const promptSignIn = useCallback((message: string) => {
    Alert.alert('Sign in required', message, [{ text: 'Not now' }, { text: 'Sign in', onPress: openSignIn }])
  }, [openSignIn])

  const loadFeed = useCallback(async (opts: { isRefresh?: boolean; nextPage?: number } = {}) => {
    const { isRefresh = false, nextPage = 1 } = opts
    if (isRefresh) setRefreshing(true)
    else if (nextPage > 1) setLoadingMore(true)
    else setFeedLoading(true)
    setFeedError('')
    try {
      const [categoryResponse, articleResponse] = await Promise.all([
        nextPage === 1 ? fetch(`${API_BASE}/api/categories`) : Promise.resolve(null),
        fetch(`${API_BASE}/api/articles?limit=30&page=${nextPage}`),
      ])
      if ((categoryResponse && !categoryResponse.ok) || !articleResponse.ok) throw new Error('The newsroom service is temporarily unavailable.')
      const articleJson = await articleResponse.json()
      if (categoryResponse) {
        const categoryJson = await categoryResponse.json()
        setCategories(Array.isArray(categoryJson.data) ? categoryJson.data : [])
      }
      const newArticles: Article[] = Array.isArray(articleJson.data) ? articleJson.data : []
      setArticles(current => (nextPage === 1 ? newArticles : [...current, ...newArticles]))
      setHasNextPage(Boolean(articleJson.pagination?.hasNextPage))
      setPage(nextPage)
    } catch (error) {
      setFeedError(error instanceof Error ? error.message : 'Unable to load research.')
    } finally {
      setFeedLoading(false)
      setRefreshing(false)
      setLoadingMore(false)
    }
  }, [])

  const loadMarketMovers = useCallback(async (exchange: 'NSE' | 'BSE') => {
    setMarketLoading(true)
    setMarketError('')
    try {
      const response = await fetch(API_BASE + '/api/market/movers?exchange=' + exchange + '&count=20')
      const json = await response.json()
      if (!response.ok) throw new Error(json.message || json.error || 'Market data is temporarily unavailable.')
      setMarketMovers(json as MarketMovers)
    } catch (error) {
      setMarketError(error instanceof Error ? error.message : 'Unable to load market movers.')
      setMarketMovers(null)
    } finally { setMarketLoading(false) }
  }, [])

  useEffect(() => {
    if (tab === 'NSE' || tab === 'BSE') void loadMarketMovers(tab)
  }, [tab, loadMarketMovers])

  const loadTicker = useCallback(async () => {
    try {
      const response = await fetch(API_BASE + '/api/market/ticker')
      const json = await response.json()
      if (!response.ok) throw new Error(json.message || 'Ticker unavailable')
      setTicker(json as MarketTicker)
    } catch {
      // Keep the last successful ticker visible if a refresh fails.
    }
  }, [])

  useEffect(() => {
    void loadTicker()
    const interval = setInterval(() => void loadTicker(), 60_000)
    return () => clearInterval(interval)
  }, [loadTicker])

  useEffect(() => {
    if (!tickerContentWidth) return
    let offset = 0
    const halfWidth = tickerContentWidth / 2
    const interval = setInterval(() => {
      offset += 1
      if (offset >= halfWidth) offset = 0
      tickerScrollRef.current?.scrollTo({ x: offset, animated: false })
    }, 35)
    return () => clearInterval(interval)
  }, [tickerContentWidth, ticker?.items?.length])

  const loadBriefing = async (article: Article) => {
    setBriefingLoading(true)
    setBriefingError('')
    setBriefingSummary(null)
    try {
      const response = await fetch(`${API_BASE}/api/insights/summary`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: article.slug }),
      })
      const json = await response.json()
      if (!response.ok) throw new Error(json.message || json.error || 'Unable to generate the briefing.')
      setBriefingSummary(json.data)
    } catch (error) {
      setBriefingError(error instanceof Error ? error.message : 'Unable to generate the briefing.')
    } finally { setBriefingLoading(false) }
  }

  const loadRelatedStories = async (article: Article) => {
    setRelatedLoading(true)
    try {
      const response = await fetch(`${API_BASE}/api/insights/context/${encodeURIComponent(article.slug)}`)
      const json = await response.json()
      if (response.ok) setRelatedStories(Array.isArray(json.data) ? json.data : [])
      else setRelatedStories([])
    } catch { setRelatedStories([]) }
    finally { setRelatedLoading(false) }
  }

  const toggleBriefingTopic = (topic: string) => {
    setBriefingTopics(current => {
      const next = current.includes(topic) ? current.filter(item => item !== topic) : [...current, topic]
      AsyncStorage.setItem(TOPICS_STORAGE_KEY, JSON.stringify(next)).catch(() => undefined)
      return next
    })
  }

  const loadMoreArticles = useCallback(() => {
    if (hasNextPage && !loadingMore && !feedLoading) void loadFeed({ nextPage: page + 1 })
  }, [hasNextPage, loadingMore, feedLoading, page, loadFeed])

  const loadMemberData = useCallback(async (accessToken: string) => {
    const headers = { Authorization: `Bearer ${accessToken}` }
    try {
      await fetch(`${API_BASE}/api/users/me`, { headers })
      const response = await fetch(`${API_BASE}/api/subscriptions/me`, { headers })
      if (response.ok) {
        const json = await response.json()
        setActiveSubscription(json.data || null)
      }
    } catch {
      // Free research remains available when membership APIs are offline.
    }
  }, [])

  const loadNotifications = useCallback(async () => {
    if (!session?.access_token) return
    setNotificationsLoading(true)
    try {
      const response = await fetch(`${API_BASE}/api/notifications`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      })
      if (response.ok) {
        const json = await response.json()
        setNotificationItems(Array.isArray(json.data) ? json.data : [])
      }
    } catch {
      // The screen will show an empty state if notifications cannot be loaded.
    } finally {
      setNotificationsLoading(false)
    }
  }, [session?.access_token])

  const registerPushDevice = useCallback(async (accessToken: string) => {
    if (!Device.isDevice) return
    try {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('market-research', {
          name: 'Market research',
          importance: Notifications.AndroidImportance.DEFAULT,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#087BFF',
        })
      }
      const current = await Notifications.getPermissionsAsync()
      let status = current.status
      if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status
      if (status !== 'granted') return
      const projectId = Constants.expoConfig?.extra?.eas?.projectId || (Constants as any).easConfig?.projectId
      if (!projectId) {
        console.warn('Set the EAS projectId to enable remote push notifications.')
        return
      }
      const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data
      await fetch(`${API_BASE}/api/devices/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ token, platform: Platform.OS === 'ios' ? 'ios' : 'android' }),
      })
    } catch (error) {
      console.warn('Push registration failed:', error instanceof Error ? error.message : error)
    }
  }, [])

  const iap = useIAP({
    onPurchaseSuccess: async (purchase: any) => {
      const productId = purchase.productId || purchase.id
      const purchaseToken = purchase.purchaseToken
      if (!session?.access_token || typeof productId !== 'string' || typeof purchaseToken !== 'string') {
        Alert.alert('Purchase pending', 'We could not read the purchase details. Please use Restore Purchases or contact support before trying again.')
        return
      }
      try {
        const response = await fetch(`${API_BASE}/api/subscriptions/verify-google-play`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ productId, purchaseToken, planType: `${chosenPlan}_${planCycle.toUpperCase()}` }),
        })
        const json = await response.json()
        if (!response.ok) throw new Error(json.message || json.error || 'Google Play could not verify this purchase.')
        await finishTransactionRef.current?.({ purchase, isConsumable: false })
        setActiveSubscription(json.data || null)
        setScreen('home')
        Alert.alert('Subscription activated', 'Your BazaarNexa premium access is now active.')
        void loadMemberData(session.access_token)
      } catch (error) {
        Alert.alert('Purchase verification failed', error instanceof Error ? error.message : 'Please contact support. Do not purchase again until this transaction is resolved.')
      }
    },
    onPurchaseError: (error: any) => {
      if (error?.code === 'UserCancelled' || error?.code === 'user-cancelled') return
      Alert.alert('Google Play purchase failed', error?.message || 'Please try again later.')
    },
    onError: (error: Error) => console.warn('Billing error:', error.message),
  })
  const { connected: billingConnected, subscriptions: billingProducts, fetchProducts, requestPurchase, finishTransaction } = iap

  useEffect(() => {
    finishTransactionRef.current = finishTransaction as any
  }, [finishTransaction])

  useEffect(() => {
    if (!billingConnected) return
    const skus = Object.values(PLAY_PRODUCTS).filter(Boolean)
    if (skus.length) void fetchProducts({ skus, type: 'subs' })
  }, [billingConnected, fetchProducts])

  const buySelectedPlan = async () => {
    if (!session?.access_token) {
      promptSignIn('Sign in to purchase a BazaarNexa subscription.')
      return
    }
    const productKey = `${chosenPlan}_${planCycle.toUpperCase()}` as keyof typeof PLAY_PRODUCTS
    const productId = PLAY_PRODUCTS[productKey]
    if (!productId) {
      Alert.alert('Plan not configured', 'The matching Google Play product ID has not been configured in the mobile environment.')
      return
    }
    if (!billingConnected) {
      Alert.alert('Billing unavailable', 'Google Play Billing is not connected. Install the Android development build and try again.')
      return
    }
    const product = billingProducts.find(item => item.id === productId)
    if (!product) {
      Alert.alert('Plan unavailable', 'Google Play has not returned this subscription product. Check the product ID and Play Console setup.')
      return
    }
    const offers =
      Platform.OS === 'android' && 'subscriptionOfferDetailsAndroid' in product
        ? product.subscriptionOfferDetailsAndroid
        : []
    if (!offers.length) {
      Alert.alert('Plan unavailable', 'Google Play did not return a subscription offer for this product. Check its base plan and offer configuration in Play Console.')
      return
    }
    try {
      await requestPurchase({
        request: {
          apple: { sku: productId },
          google: {
            skus: [productId],
            ...(offers.length ? { subscriptionOffers: offers.map(offer => ({ sku: productId, offerToken: offer.offerToken })) } : {}),
          },
        },
        type: 'subs',
      })
    } catch (error) {
      Alert.alert('Unable to start checkout', error instanceof Error ? error.message : 'Please try again later.')
    }
  }

  const restorePurchases = async () => {
    if (!session?.access_token) {
      promptSignIn('Sign in to restore your BazaarNexa subscription.')
      return
    }
    try {
      const purchases = await getAvailablePurchases()
      if (!purchases.length) {
        Alert.alert('No purchases found', 'Google Play did not return any restorable subscriptions for this account.')
        return
      }
      let restored = false
      for (const purchase of purchases) {
        const productId = purchase.productId || purchase.id
        const purchaseToken = purchase.purchaseToken
        if (typeof productId !== 'string' || typeof purchaseToken !== 'string') continue
        const response = await fetch(`${API_BASE}/api/subscriptions/verify-google-play`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ productId, purchaseToken, planType: productId }),
        })
        const json = await response.json()
        if (response.ok && json.data) {
          await finishTransactionRef.current?.({ purchase, isConsumable: false })
          setActiveSubscription(json.data)
          restored = true
        }
      }
      if (restored) {
        setScreen('home')
        Alert.alert('Subscription restored', 'Your verified BazaarNexa subscription is active.')
        void loadMemberData(session.access_token)
      } else {
        Alert.alert('Could not restore subscription', 'No active eligible Google Play subscription was verified for this account.')
      }
    } catch (error) {
      Alert.alert('Restore failed', error instanceof Error ? error.message : 'Please try again later.')
    }
  }

  useEffect(() => {
    // Articles are public; guests see the feed without signing in.
    loadFeed()
  }, [loadFeed])

  useEffect(() => {
    if (session) {
      loadMemberData(session.access_token)
      void registerPushDevice(session.access_token)
    } else {
      setActiveSubscription(null)
    }
  }, [session, loadMemberData, registerPushDevice])

  useEffect(() => {
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data
      const slug = typeof data?.articleSlug === 'string' ? data.articleSlug : ''
      if (!slug) return
      setScreen('home')
      fetch(`${API_BASE}/api/articles/${encodeURIComponent(slug)}`, { headers: { Authorization: `Bearer ${session?.access_token || ''}` } })
        .then(async response => {
          const json = await response.json()
          if (response.ok && json.data) setSelectedArticle(json.data)
          else if (response.status === 403) Alert.alert('Premium research', 'An active subscription is required to read this article.')
        })
        .catch(() => Alert.alert('Article unavailable', 'Please open BazaarNexa and try again.'))
    })
    return () => responseSubscription.remove()
  }, [session?.access_token])

  useEffect(() => {
    if (!savedLoaded) return
    AsyncStorage.setItem(SAVED_STORAGE_KEY, JSON.stringify(savedIds)).catch(() => undefined)
  }, [savedIds, savedLoaded])

  const openArticle = async (article: Article) => {
    setSelectedArticle(article)
    setBriefingSummary(null)
    setBriefingError('')
    setRelatedStories([])
    void loadRelatedStories(article)
    try {
      const headers: Record<string, string> = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
      const response = await fetch(`${API_BASE}/api/articles/${encodeURIComponent(article.slug)}`, { headers })
      const json = await response.json()
      if (response.status === 403 || json.error === 'PREMIUM_REQUIRED') {
        setSelectedArticle(null)
        if (!session) {
          Alert.alert('Premium research', 'Sign in and subscribe to read this report.', [{ text: 'Not now' }, { text: 'Sign in', onPress: openSignIn }])
        } else {
          Alert.alert('Premium research', 'An active BazaarNexa subscription is required to read this report.', [{ text: 'Not now' }, { text: 'View plans', onPress: () => { setSelectedArticle(null); setScreen('plans') } }])
        }
        return
      }
      if (response.ok && json.data) setSelectedArticle(json.data)
    } catch {
      // Keep the article card data available if the detail request fails.
    }
  }

  useEffect(() => {
    if (Platform.OS !== 'android') return
    const onBackPress = () => {
      if (selectedArticle) {
        setSelectedArticle(null)
        return true
      }
      if (searchOpen) {
        setSearchOpen(false)
        return true
      }
      if (screen === 'payment') {
        setScreen('plans')
        return true
      }
      if (screen !== 'home') {
        setScreen('home')
        return true
      }
      Alert.alert('Exit BazaarNexa', 'Are you sure you want to exit?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Exit', style: 'destructive', onPress: () => BackHandler.exitApp() },
      ])
      return true
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress)
    return () => subscription.remove()
  }, [selectedArticle, searchOpen, screen])

  // Reflects whatever the newsroom actually publishes — a real "cricket" category
  // from /api/categories will light this up with zero further frontend changes.
  const hasCricketCategory = useMemo(
    () => categories.some(c => c.slug?.toLowerCase().includes('cricket') || c.name?.toLowerCase().includes('cricket')),
    [categories]
  )

  const visibleArticles = useMemo(() => {
    let result = articles
    if (filter === 'All' && tab === 'Home' && briefingTopics.length > 0) {
      result = result.filter(article => briefingTopics.some(topic => `${article.categories?.name || ''} ${article.categories?.slug || ''} ${article.title}`.toLowerCase().includes(topic.toLowerCase())))
    }
    const chosen = tab === 'Crypto' || tab === 'Cricket' ? tab : filter
    if (chosen === 'Crypto') result = result.filter(a => a.categories?.slug?.toLowerCase().includes('crypto') || a.categories?.name?.toLowerCase().includes('crypto'))
    else if (chosen === 'Cricket') result = result.filter(a => a.categories?.slug?.toLowerCase().includes('cricket') || a.categories?.name?.toLowerCase().includes('cricket'))
    else if (chosen === 'India') result = result.filter(a => a.categories?.slug?.toLowerCase().includes('india') || a.categories?.name?.toLowerCase().includes('india'))
    else if (chosen === 'Sensex' || chosen === 'Nifty 50') result = result.filter(a => a.title.toLowerCase().includes(chosen.toLowerCase()) || a.slug.toLowerCase().includes(chosen.toLowerCase()))
    if (search.trim()) result = result.filter(a => a.title.toLowerCase().includes(search.trim().toLowerCase()))
    return result
  }, [articles, filter, tab, search, briefingTopics])

  const signOut = async () => {
    await supabase.auth.signOut()
    setStep('phone')
    setOtp('')
    setSelectedArticle(null)
    setScreen('home')
  }

  const choosePlan = (plan: 'BASIC' | 'PRO') => {
    setChosenPlan(plan)
    setScreen('payment')
  }

  const formatExpiry = (value: string) => new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

  if (supabaseConfigError) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
        <Text style={styles.stateTitle}>Configuration required</Text>
        <Text style={[styles.muted, styles.configErrorText]}>{supabaseConfigError}</Text>
      </SafeAreaView>
    )
  }

  if (initializing) {
    return <SafeAreaView style={styles.loadingScreen}><StatusBar barStyle="light-content" backgroundColor={COLORS.background} /><ActivityIndicator color={COLORS.blue} size="large" /><Text style={styles.muted}>Preparing BazaarNexa…</Text></SafeAreaView>
  }

  if (screen === 'auth') {
    return (
      <SafeAreaView style={styles.authScreen}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
        <Pressable onPress={() => setScreen('home')} style={styles.authBackButton} hitSlop={10}>
          <Text style={styles.backText}>‹  Continue browsing</Text>
        </Pressable>
        <View style={styles.authHero}>
          <View style={styles.logo}><Text style={styles.logoGlyph}>↗</Text><Text style={styles.logoBars}>▥</Text></View>
          <Text style={styles.wordmark}>Bazaar<Text style={styles.wordmarkBlue}>Nexa</Text></Text>
          <Text style={styles.tagline}>India & Crypto Research</Text>
          <View style={styles.featureRow}><Text style={styles.feature}>▤  In-depth articles</Text><Text style={styles.feature}>▥  Market insights</Text></View>
        </View>
        <View style={styles.authCard}>
          <Text style={styles.authTitle}>{step === 'phone' ? 'Welcome back' : 'Verify your number'}</Text>
          <Text style={styles.authSubtitle}>{step === 'phone' ? 'Log in to continue to BazaarNexa' : `Enter the 6-digit OTP sent to +91 ${phone}`}</Text>
          {step === 'phone' ? (
            <View style={styles.phoneRow}>
              <View style={styles.countryCode}><Text style={styles.countryCodeText}>🇮🇳  +91</Text></View>
              <TextInput value={phone} onChangeText={v => setPhone(v.replace(/\D/g, '').slice(0, 10))} keyboardType="phone-pad" placeholder="Enter your mobile number" placeholderTextColor={COLORS.muted} maxLength={10} style={styles.authInput} editable={!authLoading} />
            </View>
          ) : (
            <TextInput value={otp} onChangeText={v => setOtp(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" placeholder="6-digit OTP" placeholderTextColor={COLORS.muted} maxLength={6} style={[styles.authInput, styles.otpInput]} editable={!authLoading} />
          )}
          <Pressable style={[styles.primaryButton, authLoading && styles.disabled]} onPress={step === 'phone' ? sendOtp : verifyOtp} disabled={authLoading}>
            {authLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>{step === 'phone' ? 'Send OTP   →' : 'Verify OTP   →'}</Text>}
          </Pressable>
          {step === 'otp' && (
            <View style={styles.otpActionsRow}>
              <Pressable style={styles.textButton} onPress={() => { setStep('phone'); setOtp(''); setResendCooldown(0) }}><Text style={styles.linkText}>Change mobile number</Text></Pressable>
              <Pressable style={styles.textButton} onPress={sendOtp} disabled={authLoading || resendCooldown > 0}>
                <Text style={[styles.linkText, resendCooldown > 0 && styles.linkTextDisabled]}>{resendCooldown > 0 ? `Resend OTP in ${resendCooldown}s` : 'Resend OTP'}</Text>
              </Pressable>
            </View>
          )}
          <Text style={styles.legal}>By continuing, you agree to our Terms & Conditions and Privacy Policy.</Text>
        </View>
        <Text style={styles.disclaimer}>Research and educational content only. Not investment advice.</Text>
      </SafeAreaView>
    )
  }

  if (selectedArticle) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
        <View style={styles.detailHeader}>
          <Pressable onPress={() => setSelectedArticle(null)} style={styles.backButton} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back"><Text style={styles.backText}>‹  Back</Text></Pressable>
          <Text style={styles.detailBrand}>BazaarNexa</Text>
          <View style={{ width: 48 }} />
        </View>
        <ScrollView contentContainerStyle={styles.detailContent}>
          {selectedArticle.image_url ? <Image source={{ uri: selectedArticle.image_url }} style={styles.detailImage} resizeMode="cover" /> : null}
          <Text style={styles.categoryLabel}>{selectedArticle.categories?.name || 'RESEARCH'}</Text>
          <Text style={styles.detailTitle}>{selectedArticle.title}</Text>
          <Text style={styles.articleMeta}>{readableDate(selectedArticle.published_at)}  ·  {selectedArticle.access_type === 'PREMIUM' ? 'Premium' : 'Free'}</Text>
          <Text style={styles.articleBody}>{selectedArticle.content || 'The full article content is not available yet.'}</Text>
          {selectedArticle.source_url ? <Pressable onPress={() => Linking.openURL(selectedArticle.source_url!).catch(() => Alert.alert('Unable to open source', 'Please try again later.'))} style={styles.sourceLink}><Text style={styles.insightSource}>Read original reporting · {selectedArticle.source_name || 'Publisher'} ↗</Text></Pressable> : null}
          <View style={styles.insightPanel}>
            <Text style={styles.insightTitle}>AI-powered briefing</Text>
            <Text style={styles.muted}>A concise, source-linked summary. AI output may contain errors; check the original reporting.</Text>
            <Pressable onPress={() => void loadBriefing(selectedArticle)} style={[styles.primaryButton, briefingLoading && styles.disabled]} disabled={briefingLoading}>
              {briefingLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Summarize this story ✦</Text>}
            </Pressable>
            {briefingError ? <Text style={styles.insightError}>{briefingError}</Text> : null}
            {briefingSummary ? <>
              <Text style={styles.insightSubheading}>Key points</Text>
              {briefingSummary.bullets.map((bullet, index) => <Text key={`${index}-${bullet}`} style={styles.insightBullet}>•  {bullet}</Text>)}
              {briefingSummary.keyTerms.length ? <Text style={styles.insightSubheading}>Key terms</Text> : null}
              {briefingSummary.keyTerms.map(item => <Text key={item.term} style={styles.insightBullet}><Text style={styles.insightTerm}>{item.term}: </Text>{item.explanation}</Text>)}
              {briefingSummary.sourceUrl ? <Pressable onPress={() => Linking.openURL(briefingSummary.sourceUrl!).catch(() => Alert.alert('Unable to open source', 'Please copy the original source URL from the publisher.'))}><Text style={styles.insightSource}>Open original source: {briefingSummary.sourceName || 'Publisher'} ↗</Text></Pressable> : null}
              <Text style={styles.muted}>AI-generated summary, not investment advice.</Text>
            </> : null}
          </View>
          <View style={styles.insightPanel}>
            <Text style={styles.insightTitle}>Story context & source comparison</Text>
            <Text style={styles.muted}>Related coverage in BazaarNexa, ordered by publication date.</Text>
            {relatedLoading ? <ActivityIndicator color={COLORS.blue} /> : relatedStories.length ? relatedStories.map(story => <Pressable key={story.id} onPress={() => void openArticle(story)} style={styles.relatedStory}>
              <Text style={styles.articleTag}>{story.categories?.name || 'Research'}</Text>
              <Text style={styles.relatedTitle}>{story.title}</Text>
              <Text style={styles.articleTime}>{story.source_name || story.categories?.name || 'Publisher'} · {readableDate(story.published_at)}</Text>
              {story.source_url ? <Pressable onPress={() => Linking.openURL(story.source_url!).catch(() => undefined)}><Text style={styles.insightSource}>Compare source ↗</Text></Pressable> : null}
            </Pressable>) : <Text style={styles.muted}>No related coverage found yet. More sources will appear as the newsroom grows.</Text>}
          </View>
          <Text style={styles.disclaimer}>For research and educational purposes only. Not investment advice.</Text>
        </ScrollView>
      </SafeAreaView>
    )
  }

  if (screen === 'plans' || screen === 'payment') {
    const basicKey = `BASIC_${planCycle.toUpperCase()}` as keyof typeof PLAY_PRODUCTS
    const proKey = `PRO_${planCycle.toUpperCase()}` as keyof typeof PLAY_PRODUCTS
    const basicPrice = billingProducts.find(item => item.id === PLAY_PRODUCTS[basicKey])?.displayPrice || (planCycle === 'monthly' ? '₹499 / month' : '₹3,599 / year')
    const proPrice = billingProducts.find(item => item.id === PLAY_PRODUCTS[proKey])?.displayPrice || (planCycle === 'monthly' ? '₹999 / month' : '₹7,199 / year')
    const chosenProductKey = `${chosenPlan}_${planCycle.toUpperCase()}` as keyof typeof PLAY_PRODUCTS
    const chosenProductId = PLAY_PRODUCTS[chosenProductKey]
    const chosenProduct = billingProducts.find(item => item.id === chosenProductId)
    const checkoutReady = Boolean(billingConnected && chosenProductId && chosenProduct)
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
        <View style={styles.detailHeader}>
          <Pressable onPress={() => setScreen(screen === 'payment' ? 'plans' : 'home')} style={styles.backButton}><Text style={styles.backText}>‹  Back</Text></Pressable>
          <Text style={styles.detailBrand}>{screen === 'plans' ? 'Choose your plan' : 'Payment details'}</Text>
          <View style={{ width: 48 }} />
        </View>
        <ScrollView contentContainerStyle={styles.plansContent}>
          {screen === 'plans' ? (
            <>
              <View style={styles.plansHero}>
                <Text style={styles.premiumText}>♛ BAZAARNEXA PREMIUM</Text>
                <Text style={styles.plansTitle}>Research with more depth.</Text>
                <Text style={styles.muted}>Unlock premium articles, detailed company and sector analysis, and market reports.</Text>
              </View>
              {activeSubscription ? (
                <View style={styles.activePlanCard}>
                  <Text style={styles.activePlanTitle}>Your subscription is active</Text>
                  <Text style={styles.muted}>{activeSubscription.plan_type} · valid until {formatExpiry(activeSubscription.expiry_date)}</Text>
                </View>
              ) : null}
              <View style={styles.cycleToggle}>
                <Pressable onPress={() => setPlanCycle('monthly')} style={[styles.cycleButton, planCycle === 'monthly' && styles.cycleButtonActive]}><Text style={[styles.cycleText, planCycle === 'monthly' && styles.cycleTextActive]}>Monthly</Text></Pressable>
                <Pressable onPress={() => setPlanCycle('yearly')} style={[styles.cycleButton, planCycle === 'yearly' && styles.cycleButtonActive]}><Text style={[styles.cycleText, planCycle === 'yearly' && styles.cycleTextActive]}>Yearly · save 40%</Text></Pressable>
              </View>
              <View style={[styles.planCard, chosenPlan === 'BASIC' && styles.planCardSelected]}>
                <View style={styles.planTitleRow}><Text style={styles.planName}>Basic</Text><Text style={styles.planPrice}>{basicPrice}</Text></View>
                {['Daily market research', 'Nifty 50 & Sensex analysis', 'Crypto market analysis', 'Stock & sector research', 'Weekly and monthly reports', 'Ad-free reading'].map(item => <Text key={item} style={styles.planFeature}>✓  {item}</Text>)}
                <Pressable onPress={() => choosePlan('BASIC')} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Choose Basic  →</Text></Pressable>
              </View>
              <View style={[styles.planCard, chosenPlan === 'PRO' && styles.planCardSelected]}>
                <View style={styles.planTitleRow}><Text style={styles.planName}>Pro</Text><Text style={styles.planPrice}>{proPrice}</Text></View>
                {['Everything in Basic', 'In-depth research reports', 'Company and sector deep-dives', 'Global market context', 'Early access to special reports', 'Access across devices'].map(item => <Text key={item} style={styles.planFeature}>✓  {item}</Text>)}
                <Pressable onPress={() => choosePlan('PRO')} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Choose Pro  →</Text></Pressable>
              </View>
              <Text style={styles.disclaimer}>Prices shown are proposed display values and must match the final Google Play Console product prices before release. Subscriptions renew according to the selected Play Store plan.</Text>
            </>
          ) : (
            <>
              <View style={styles.plansHero}>
                <Text style={styles.premiumText}>SECURE CHECKOUT</Text>
                <Text style={styles.plansTitle}>{chosenPlan === 'BASIC' ? 'Basic' : 'Pro'} plan</Text>
                <Text style={styles.planPrice}>{chosenPlan === 'BASIC' ? basicPrice : proPrice}</Text>
                <Text style={styles.muted}>Payments are handled by Google Play on Android. Your subscription is activated only after the server verifies the purchase with Google Play.</Text>
              </View>
              <View style={styles.paymentMethod}>
                <Text style={styles.paymentMethodTitle}>Google Play Billing</Text>
                <Text style={styles.muted}>UPI, cards and other supported payment methods are shown by Google Play based on your account and region.</Text>
              </View>
              {checkoutReady ? (
                <>
                  <View style={styles.activePlanCard}>
                    <Text style={styles.activePlanTitle}>Google Play product available</Text>
                    <Text style={styles.muted}>{chosenProduct?.title || chosenProductId} · {chosenProduct?.displayPrice || (chosenPlan === 'BASIC' ? basicPrice : proPrice)}</Text>
                  </View>
                  <Pressable onPress={buySelectedPlan} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Continue with Google Play  →</Text></Pressable>
                  <Pressable onPress={restorePurchases} style={styles.textButton}><Text style={styles.linkText}>Restore purchases</Text></Pressable>
                  <Text style={styles.disclaimer}>Your purchase will be verified by the BazaarNexa server before premium access is activated.</Text>
                </>
              ) : (
                <>
                  <View style={styles.stateCard}>
                    <Text style={styles.stateTitle}>Google Play setup incomplete</Text>
                    <Text style={styles.muted}>To enable checkout, configure the selected product ID in mobile/.env, create that subscription in Play Console, install an Android development build, and configure Google Play service-account credentials in Render.</Text>
                  </View>
                  <Pressable disabled style={[styles.primaryButton, styles.disabled]}><Text style={styles.primaryButtonText}>Checkout not configured</Text></Pressable>
                  <Pressable onPress={restorePurchases} style={styles.textButton}><Text style={styles.linkText}>Restore purchases</Text></Pressable>
                  <Text style={styles.disclaimer}>No payment will be taken until Google Play returns the configured product.</Text>
                </>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    )
  }

  if (screen === 'notifications') {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
        <View style={styles.detailHeader}>
          <Pressable onPress={() => setScreen('home')} style={styles.backButton}><Text style={styles.backText}>‹  Back</Text></Pressable>
          <Text style={styles.detailBrand}>Notifications</Text>
          <Pressable onPress={loadNotifications} style={styles.backButton}><Text style={styles.backText}>Refresh</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.plansContent}>
          <Text style={styles.plansTitle}>Market alerts & research</Text>
          {!session ? (
            <View style={styles.stateCard}>
              <Text style={styles.stateTitle}>Sign in required</Text>
              <Text style={styles.muted}>Notifications are tied to your BazaarNexa account. Sign in to see research alerts.</Text>
              <Pressable onPress={openSignIn} style={styles.retryButton}><Text style={styles.retryText}>Sign in</Text></Pressable>
            </View>
          ) : (
            <>
              {notificationsLoading ? <ActivityIndicator color={COLORS.blue} size="large" /> : null}
              {!notificationsLoading && notificationItems.length === 0 ? <View style={styles.stateCard}><Text style={styles.stateTitle}>You're all caught up</Text><Text style={styles.muted}>When new research is published, notifications will appear here and on your device when push notifications are configured.</Text></View> : null}
              {notificationItems.map(item => (
                <Pressable key={item.id} style={styles.notificationCard} onPress={() => {
                  const slug = item.articles?.slug
                  if (!slug) return
                  void openArticle({ id: item.article_id || item.id, slug, title: item.title })
                  setScreen('home')
                }}>
                  <Text style={styles.notificationTitle}>{item.title}</Text>
                  <Text style={styles.muted}>{item.message}</Text>
                  <Text style={styles.articleTime}>{readableDate(item.created_at)}</Text>
                </Pressable>
              ))}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    )
  }

  if (screen === 'saved') {
    const savedArticles = articles.filter(article => savedIds.includes(article.id))
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
        <View style={styles.detailHeader}>
          <Pressable onPress={() => setScreen('home')} style={styles.backButton}><Text style={styles.backText}>‹  Back</Text></Pressable>
          <Text style={styles.detailBrand}>Saved articles</Text>
          <View style={{ width: 48 }} />
        </View>
        <ScrollView contentContainerStyle={styles.plansContent}>
          {savedArticles.length === 0 ? <View style={styles.stateCard}><Text style={styles.stateTitle}>No saved articles yet</Text><Text style={styles.muted}>Tap the bookmark icon on any article to save it for later.</Text></View> : null}
          {savedArticles.map(article => (
            <Pressable key={article.id} onPress={() => openArticle(article)} style={styles.articleCard}>
              {article.image_url ? <Image source={{ uri: article.image_url }} style={styles.articleImage} resizeMode="cover" /> : <View style={styles.articleImageFallback}><Text style={styles.fallbackGlyph}>↗</Text></View>}
              <View style={styles.articleCopy}><Text style={styles.articleTag}>{article.categories?.name || 'Research'}</Text><Text style={styles.articleTitle}>{article.title}</Text><Text style={styles.readMore}>Read article →</Text></View>
              <Pressable onPress={() => setSavedIds(ids => ids.filter(id => id !== article.id))}><Text style={styles.bookmark}>✕</Text></Pressable>
            </Pressable>
          ))}
        </ScrollView>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <View style={styles.tickerBar}>
        <Text style={styles.tickerLabel}>LIVE</Text>
        {ticker?.items?.length ? <ScrollView ref={tickerScrollRef} horizontal showsHorizontalScrollIndicator={false} onContentSizeChange={width => setTickerContentWidth(width)} contentContainerStyle={styles.tickerContent}>
          {[...ticker.items, ...ticker.items].map((item, index) => <View key={item.kind + '-' + item.exchange + '-' + item.symbol + '-' + index} style={styles.tickerItem}>
            <Text style={styles.tickerSymbol}>{item.symbol}{item.exchange ? ' · ' + item.exchange : ''}</Text>
            <Text style={styles.tickerPrice}>{item.currency === 'INR' ? '₹' : ''}{item.price.toLocaleString('en-IN', { maximumFractionDigits: item.price < 100 ? 2 : 0 })}</Text>
            {item.percentChange !== null ? <Text style={[styles.tickerChange, item.percentChange >= 0 ? styles.moverPositive : styles.moverNegative]}>{item.percentChange >= 0 ? '+' : ''}{item.percentChange.toFixed(2)}%</Text> : null}
            <Text style={styles.tickerSeparator}>◆</Text>
          </View>)}
        </ScrollView> : <Text style={styles.tickerLoading}>Loading market data…</Text>}
      </View>
      <View style={styles.header}>
        <View style={styles.brandMark}><Text style={styles.brandMarkText}>↗</Text></View>
        <View style={styles.headerCopy}><Text style={styles.headerTitle}>Bazaar<Text style={styles.wordmarkBlue}>Nexa</Text></Text><Text style={styles.headerSub}>INDIA & CRYPTO RESEARCH</Text></View>
        <Pressable onPress={() => { setSearchOpen(open => !open); setSearch('') }} style={styles.headerIcon}><Text style={styles.headerIconText}>⌕</Text></Pressable>
        <Pressable onPress={() => { setScreen('notifications'); if (session) void loadNotifications() }} style={styles.headerIcon}><Text style={styles.headerIconText}>♧</Text></Pressable>
        {session ? (
          <Pressable onPress={() => Alert.alert('Account', 'Signed in as ' + (session.user.phone || 'member'), [{ text: 'Close' }, { text: 'Saved articles', onPress: () => setScreen('saved') }, { text: 'Sign out', style: 'destructive', onPress: signOut }])} style={styles.avatar}><Text style={styles.avatarText}>●</Text></Pressable>
        ) : (
          <Pressable onPress={openSignIn} style={styles.signInPill}><Text style={styles.signInPillText}>Sign in</Text></Pressable>
        )}
      </View>
      {searchOpen ? <View style={styles.searchRow}><TextInput autoFocus value={search} onChangeText={setSearch} placeholder="Search research…" placeholderTextColor={COLORS.muted} style={styles.searchInput} /></View> : null}
      <FlatList
        data={visibleArticles}
        keyExtractor={article => article.id}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadFeed({ isRefresh: true })} tintColor={COLORS.blue} />}
        contentContainerStyle={styles.feedContent}
        initialNumToRender={8}
        windowSize={7}
        removeClippedSubviews={Platform.OS !== 'web'}
        renderItem={({ item: article, index }) => (
          <Pressable onPress={() => openArticle(article)} style={styles.articleCard}>
            {article.image_url ? <Image source={{ uri: article.image_url }} style={styles.articleImage} resizeMode="cover" /> : <View style={styles.articleImageFallback}><Text style={styles.fallbackGlyph}>{article.categories?.slug?.includes('crypto') ? '₿' : article.categories?.slug?.includes('cricket') ? '🏏' : '↗'}</Text></View>}
            <View style={styles.articleCopy}>
              <View style={styles.articleTopline}><Text style={[styles.articleTag, index % 3 === 1 && styles.articleTagPurple]}>{article.categories?.name || 'Research'}</Text><Text style={styles.articleTime}>{readableDate(article.published_at)}</Text></View>
              <Text numberOfLines={3} style={styles.articleTitle}>{article.title}</Text>
              <Text numberOfLines={2} style={styles.articleSummary}>In-depth research, key developments and context to help you understand the story.</Text>
              <View style={styles.articleBottom}><Text style={styles.readMore}>Read article  →</Text><Pressable hitSlop={10} onPress={() => setSavedIds(ids => ids.includes(article.id) ? ids.filter(id => id !== article.id) : [...ids, article.id])}><Text style={styles.bookmark}>{savedIds.includes(article.id) ? '🔖' : '♧'}</Text></Pressable></View>
            </View>
          </Pressable>
        )}
        ListHeaderComponent={
          <>
            {(tab === 'NSE' || tab === 'BSE') ? (
              <View style={styles.moversPanel}>
                <View style={styles.sectionHeading}><View><Text style={styles.eyebrow}>INDIAN EQUITY MARKETS</Text><Text style={styles.sectionTitle}>{tab} Top Movers</Text></View><Pressable onPress={() => void loadMarketMovers(tab)} style={styles.retryButton}><Text style={styles.retryText}>Refresh</Text></Pressable></View>
                <View style={styles.moverTabs}>
                  <Pressable onPress={() => setMarketView('gainers')} style={[styles.moverTab, marketView === 'gainers' && styles.moverTabActive]}><Text style={[styles.moverTabText, marketView === 'gainers' && styles.moverTabTextActive]}>Top Gainers</Text></Pressable>
                  <Pressable onPress={() => setMarketView('losers')} style={[styles.moverTab, marketView === 'losers' && styles.moverTabActive]}><Text style={[styles.moverTabText, marketView === 'losers' && styles.moverTabTextActive]}>Top Losers</Text></Pressable>
                </View>
                {marketLoading ? <View style={styles.stateCard}><ActivityIndicator color={COLORS.blue} /><Text style={styles.muted}>Loading {tab} market movers…</Text></View> : null}
                {marketError ? <View style={styles.stateCard}><Text style={styles.stateTitle}>Market data unavailable</Text><Text style={styles.muted}>{marketError}</Text><Text style={styles.muted}>No sample prices are shown. Configure a licensed provider to enable live data.</Text></View> : null}
                {!marketLoading && !marketError && marketMovers?.exchange === tab ? <>
                  <Text style={styles.moverMeta}>Provider snapshot · fetched {new Date(marketMovers.fetchedAt).toLocaleString('en-IN')}</Text>
                  {marketMovers.dataTimestamp ? <Text style={styles.moverMeta}>Latest provider trade timestamp: {new Date(marketMovers.dataTimestamp).toLocaleString('en-IN')}</Text> : <Text style={styles.moverMeta}>Provider did not supply a trade timestamp.</Text>}
                  {(marketView === 'gainers' ? marketMovers.gainers : marketMovers.losers).length ? (marketView === 'gainers' ? marketMovers.gainers : marketMovers.losers).map((stock, index) => <View key={stock.exchange + '-' + stock.symbol + '-' + index} style={styles.moverRow}>
                    <View style={styles.moverRank}><Text style={styles.moverRankText}>{index + 1}</Text></View>
                    <View style={styles.moverCopy}><Text style={styles.moverName} numberOfLines={1}>{stock.name}</Text><Text style={styles.moverSymbol}>{stock.symbol} · {stock.exchange}{stock.dataTimestamp ? ' · ' + new Date(stock.dataTimestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}</Text></View>
                    <View style={styles.moverValues}><Text style={styles.moverPrice}>₹{stock.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</Text><Text style={[styles.moverChange, stock.percentChange >= 0 ? styles.moverPositive : styles.moverNegative]}>{stock.percentChange >= 0 ? '+' : ''}{stock.percentChange.toFixed(2)}%</Text></View>
                  </View>) : <View style={styles.stateCard}><Text style={styles.stateTitle}>No {marketView} data returned</Text><Text style={styles.muted}>The provider may not have data available while the market is closed.</Text></View>}
                </> : null}
                <Text style={styles.moverDisclaimer}>Market data may be delayed by the provider. For research only—not investment advice.</Text>
              </View>
            ) : null}
            <View style={styles.marketStrip}>
              <View style={styles.marketTile}><Text style={styles.marketEmoji}>🇮🇳</Text><View><Text style={styles.marketName}>INDIA</Text><Text style={styles.marketValue}>Market research</Text></View><Text style={styles.marketArrow}>↗</Text></View>
              <View style={styles.marketTile}><Text style={styles.marketEmoji}>₿</Text><View><Text style={styles.marketName}>CRYPTO</Text><Text style={styles.marketValue}>Digital assets</Text></View><Text style={styles.marketArrow}>↗</Text></View>
            </View>
            <View style={styles.sectionHeading}><View><Text style={styles.eyebrow}>YOUR DAILY BRIEFING</Text><Text style={styles.sectionTitle}>Market Insight</Text></View><Pressable onPress={() => setScreen('plans')} style={styles.premiumPill}><Text style={styles.premiumText}>{activeSubscription ? '♛ Premium Active' : '♛ Premium'}</Text></Pressable></View>
            {articles.length > 0 ? (
              <Pressable onPress={() => openArticle(articles[0])} style={styles.heroCard}>
                {articles[0].image_url ? <Image source={{ uri: articles[0].image_url }} style={styles.heroImage} resizeMode="cover" /> : <View style={styles.heroImageFallback}><Text style={styles.heroChart}>↗  INDIA  ·  CRYPTO</Text></View>}
                <View style={styles.heroOverlay}>
                  <Text style={styles.heroTag}>{articles[0].categories?.name || 'LATEST RESEARCH'}</Text>
                  <Text numberOfLines={3} style={styles.heroTitle}>{articles[0].title}</Text>
                  <Text style={styles.heroCta}>Read research   →</Text>
                </View>
              </Pressable>
            ) : (
              <View style={styles.heroEmpty}><Text style={styles.heroEmptyIcon}>▥</Text><Text style={styles.heroEmptyTitle}>Research that brings clarity</Text><Text style={styles.heroEmptyText}>Your latest published market insights will appear here.</Text></View>
            )}
            <View style={styles.sectionHeading}><View><Text style={styles.eyebrow}>CURATED FOR YOU</Text><Text style={styles.sectionTitle}>Latest Articles</Text></View><Text style={styles.articleCount}>{articles.length} articles</Text></View>
            <View style={styles.topicPanel}>
              <Text style={styles.topicTitle}>Personalize your daily briefing</Text>
              <Text style={styles.muted}>Choose topics to focus your feed. Your choices are saved on this device.</Text>
              <View style={styles.topicChoices}>{DEFAULT_TOPICS.map(topic => <Pressable key={topic} onPress={() => toggleBriefingTopic(topic)} style={[styles.filterPill, briefingTopics.includes(topic) && styles.filterPillActive]}><Text style={[styles.filterText, briefingTopics.includes(topic) && styles.filterTextActive]}>{briefingTopics.includes(topic) ? '✓ ' : '+ '}{topic}</Text></Pressable>)}</View>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {FILTERS.map(item => <Pressable key={item} onPress={() => { setFilter(item); setTab(item === 'Crypto' ? 'Crypto' : item === 'Cricket' ? 'Cricket' : 'Home') }} style={[styles.filterPill, filter === item && tab === 'Home' && styles.filterPillActive]}><Text style={[styles.filterText, filter === item && tab === 'Home' && styles.filterTextActive]}>{item}</Text></Pressable>)}
            </ScrollView>
            {feedLoading && articles.length === 0 ? <View style={styles.stateCard}><ActivityIndicator color={COLORS.blue} /><Text style={styles.muted}>Loading the newsroom…</Text></View> : null}
            {feedError ? <View style={styles.stateCard}><Text style={styles.stateTitle}>Couldn’t load research</Text><Text style={styles.muted}>{feedError}</Text><Pressable onPress={() => loadFeed()} style={styles.retryButton}><Text style={styles.retryText}>Try again</Text></Pressable></View> : null}
            {!feedLoading && !feedError && visibleArticles.length === 0 ? (
              tab === 'Cricket' && !hasCricketCategory ? (
                <View style={styles.stateCard}><Text style={styles.stateTitle}>Cricket coverage isn’t available yet</Text><Text style={styles.muted}>BazaarNexa hasn’t published a Cricket category yet. Check back soon.</Text></View>
              ) : (
                <View style={styles.stateCard}><Text style={styles.stateTitle}>No articles yet</Text><Text style={styles.muted}>Published articles matching this section will appear here. Pull down to refresh.</Text></View>
              )
            ) : null}
          </>
        }
        ListFooterComponent={
          <>
            {hasNextPage ? (
              <Pressable onPress={loadMoreArticles} disabled={loadingMore} style={[styles.retryButton, styles.loadMoreButton, loadingMore && styles.disabled]}>
                {loadingMore ? <ActivityIndicator color="#fff" /> : <Text style={styles.retryText}>Load more research</Text>}
              </Pressable>
            ) : null}
            <Text style={styles.disclaimer}>BazaarNexa provides research and educational information only. Nothing here is a recommendation to buy or sell securities or crypto assets.</Text>
          </>
        }
      />
      <View style={styles.bottomNav}>
        {NAV_TABS.map((item, index) => <Pressable key={item} onPress={() => { setScreen('home'); setTab(item); setFilter(item === 'Crypto' || item === 'Cricket' ? item : item === 'Home' || item === 'NSE' || item === 'BSE' ? 'All' : item) }} style={styles.navItem}><Text style={[styles.navIcon, tab === item && styles.navActive]}>{NAV_ICONS[index]}</Text><Text style={[styles.navLabel, tab === item && styles.navActive]}>{item}</Text><View style={[styles.navDot, tab === item && styles.navDotActive]} /></Pressable>)}
      </View>
    </SafeAreaView>
  )
}

const COLORS = {
  background: '#061426',
  surface: '#0C2037',
  surfaceLight: '#102945',
  border: '#1D3B5B',
  blue: '#087BFF',
  blueLight: '#36A3FF',
  text: '#F4F8FF',
  muted: '#8FA7C2',
  green: '#2ED59A',
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  loadingScreen: { flex: 1, backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center', gap: 12 },
  muted: { color: COLORS.muted, fontSize: 13, lineHeight: 20 },
  configErrorText: { textAlign: 'center', paddingHorizontal: 24 },
  otpActionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  linkTextDisabled: { color: COLORS.muted },
  sectionNote: { color: COLORS.muted, fontSize: 11, lineHeight: 16, marginBottom: 12 },
  moversPanel: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 16, padding: 13, marginBottom: 18, marginTop: 10 },
  moverTabs: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  moverTab: { flex: 1, borderRadius: 9, paddingVertical: 10, alignItems: 'center', backgroundColor: '#07182B', borderWidth: 1, borderColor: COLORS.border },
  moverTabActive: { backgroundColor: COLORS.blue, borderColor: COLORS.blue },
  moverTabText: { color: '#B5C7DC', fontWeight: '800', fontSize: 12 },
  moverTabTextActive: { color: '#FFFFFF' },
  moverMeta: { color: COLORS.muted, fontSize: 10, lineHeight: 15, marginBottom: 4 },
  moverRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  moverRank: { width: 25, height: 25, borderRadius: 8, backgroundColor: COLORS.surfaceLight, alignItems: 'center', justifyContent: 'center' },
  moverRankText: { color: COLORS.muted, fontSize: 10, fontWeight: '800' },
  moverCopy: { flex: 1 },
  moverName: { color: COLORS.text, fontSize: 12, fontWeight: '800' },
  moverSymbol: { color: COLORS.muted, fontSize: 9, marginTop: 4 },
  moverValues: { alignItems: 'flex-end', gap: 4 },
  moverPrice: { color: COLORS.text, fontSize: 12, fontWeight: '800' },
  moverChange: { fontSize: 12, fontWeight: '900' },
  moverPositive: { color: COLORS.green },
  moverNegative: { color: '#FF7B88' },
  moverDisclaimer: { color: COLORS.muted, fontSize: 10, lineHeight: 15, marginTop: 12 },
  loadMoreButton: { marginTop: 4, marginBottom: 14 },
  authScreen: { flex: 1, backgroundColor: COLORS.background, paddingHorizontal: 22, justifyContent: 'center' },
  authBackButton: { position: 'absolute', top: 54, left: 18, zIndex: 10, padding: 6 },
  authHero: { alignItems: 'center', marginBottom: 30 },
  logo: { width: 76, height: 76, borderRadius: 22, backgroundColor: '#073C78', borderWidth: 1, borderColor: '#197FE4', alignItems: 'center', justifyContent: 'center', marginBottom: 15 },
  logoGlyph: { color: '#42C6FF', fontSize: 48, fontWeight: '900', position: 'absolute', top: 1, right: 13 },
  logoBars: { color: '#FFFFFF', fontSize: 31, fontWeight: '900', position: 'absolute', bottom: 7, left: 15 },
  wordmark: { color: '#FFFFFF', fontSize: 31, fontWeight: '800', letterSpacing: -1 },
  wordmarkBlue: { color: COLORS.blueLight },
  tagline: { color: '#C4D5E8', fontSize: 14, marginTop: 4 },
  featureRow: { flexDirection: 'row', gap: 16, marginTop: 22 },
  feature: { color: '#AFC5DF', fontSize: 11 },
  authCard: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 24, padding: 22 },
  authTitle: { color: COLORS.text, fontSize: 25, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  authSubtitle: { color: COLORS.muted, fontSize: 14, textAlign: 'center', lineHeight: 21, marginBottom: 23 },
  phoneRow: { flexDirection: 'row', gap: 9, marginBottom: 13 },
  countryCode: { justifyContent: 'center', paddingHorizontal: 13, borderRadius: 12, borderWidth: 1, borderColor: '#45617F' },
  countryCodeText: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  authInput: { flex: 1, minHeight: 54, borderRadius: 12, borderWidth: 1, borderColor: '#45617F', paddingHorizontal: 14, color: COLORS.text, fontSize: 15, backgroundColor: '#07182B' },
  otpInput: { flex: 0, textAlign: 'center', letterSpacing: 8, marginBottom: 13 },
  primaryButton: { minHeight: 55, backgroundColor: COLORS.blue, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  disabled: { opacity: 0.6 },
  textButton: { alignItems: 'center', padding: 12 },
  linkText: { color: COLORS.blueLight, fontWeight: '700' },
  legal: { color: '#829BB6', fontSize: 11, textAlign: 'center', lineHeight: 17, marginTop: 18 },
  disclaimer: { color: '#718AA6', fontSize: 10, textAlign: 'center', lineHeight: 16, marginVertical: 18, paddingHorizontal: 8 },
  tickerBar: { height: 34, flexDirection: 'row', alignItems: 'center', backgroundColor: '#0C1220', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' },
  tickerLabel: { color: '#2ED59A', fontSize: 9, fontWeight: '900', letterSpacing: 1, paddingHorizontal: 10 },
  tickerContent: { alignItems: 'center', paddingRight: 12 },
  tickerItem: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, height: 34 },
  tickerSymbol: { color: '#CBD5E1', fontSize: 10, fontWeight: '800' },
  tickerPrice: { color: '#F8FAFC', fontSize: 10, fontWeight: '700' },
  tickerChange: { fontSize: 10, fontWeight: '800' },
  tickerSeparator: { color: '#334155', fontSize: 7, marginLeft: 5 },
  tickerLoading: { color: '#64748B', fontSize: 10, flex: 1, textAlign: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#112A43', gap: 9 },
  brandMark: { width: 39, height: 39, borderRadius: 11, backgroundColor: '#0752A2', alignItems: 'center', justifyContent: 'center' },
  brandMarkText: { color: '#49D3FF', fontSize: 32, fontWeight: '900', marginTop: -4 },
  headerCopy: { flex: 1 },
  headerTitle: { color: COLORS.text, fontSize: 18, fontWeight: '800', letterSpacing: -0.4 },
  headerSub: { color: COLORS.muted, fontSize: 8, letterSpacing: 1.3, marginTop: 2 },
  headerIcon: { width: 30, height: 34, alignItems: 'center', justifyContent: 'center' },
  headerIconText: { color: COLORS.text, fontSize: 26 },
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#153B5E', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: COLORS.blueLight, fontSize: 14 },
  signInPill: { borderWidth: 1, borderColor: COLORS.blue, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
  signInPillText: { color: COLORS.blueLight, fontSize: 12, fontWeight: '800' },
  searchRow: { paddingHorizontal: 16, paddingTop: 10 },
  searchInput: { backgroundColor: COLORS.surface, borderColor: COLORS.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 10, color: COLORS.text },
  feedContent: { paddingHorizontal: 15, paddingBottom: 18 },
  marketStrip: { flexDirection: 'row', gap: 9, marginTop: 15, marginBottom: 22 },
  marketTile: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.surface, borderColor: COLORS.border, borderWidth: 1, borderRadius: 13, padding: 11 },
  marketEmoji: { fontSize: 21 },
  marketName: { color: COLORS.text, fontSize: 10, fontWeight: '900', letterSpacing: 0.7 },
  marketValue: { color: COLORS.muted, fontSize: 9, marginTop: 3 },
  marketArrow: { color: COLORS.green, fontSize: 18, marginLeft: 'auto' },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13, marginTop: 3 },
  eyebrow: { color: COLORS.blueLight, fontSize: 9, fontWeight: '800', letterSpacing: 1.5, marginBottom: 5 },
  sectionTitle: { color: COLORS.text, fontSize: 23, fontWeight: '800', letterSpacing: -0.5 },
  premiumPill: { borderWidth: 1, borderColor: '#9E7B25', backgroundColor: '#332A16', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 6 },
  premiumText: { color: '#FFD56A', fontSize: 11, fontWeight: '800' },
  heroCard: { height: 228, borderRadius: 18, overflow: 'hidden', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, marginBottom: 25 },
  heroImage: { width: '100%', height: '100%', position: 'absolute' },
  heroImageFallback: { ...StyleSheet.absoluteFill, backgroundColor: '#103D68', justifyContent: 'center', alignItems: 'center' },
  heroChart: { color: '#50C4FF', fontSize: 19, fontWeight: '900' },
  heroOverlay: { flex: 1, justifyContent: 'flex-end', padding: 16, backgroundColor: 'rgba(3,14,28,0.48)' },
  heroTag: { color: '#7FE4D0', fontSize: 10, fontWeight: '900', letterSpacing: 1, marginBottom: 7 },
  heroTitle: { color: '#FFFFFF', fontSize: 22, lineHeight: 28, fontWeight: '900', marginBottom: 12 },
  heroCta: { color: '#FFFFFF', backgroundColor: COLORS.blue, alignSelf: 'flex-start', overflow: 'hidden', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontWeight: '800', fontSize: 12 },
  heroEmpty: { minHeight: 190, borderRadius: 18, backgroundColor: '#0C2B4C', borderWidth: 1, borderColor: COLORS.border, padding: 20, justifyContent: 'center', alignItems: 'flex-start', marginBottom: 25 },
  heroEmptyIcon: { color: COLORS.blueLight, fontSize: 34, marginBottom: 9 },
  heroEmptyTitle: { color: COLORS.text, fontSize: 18, fontWeight: '800', marginBottom: 7 },
  heroEmptyText: { color: COLORS.muted, fontSize: 13, lineHeight: 19 },
  articleCount: { color: COLORS.muted, fontSize: 11 },
  filterRow: { gap: 8, paddingBottom: 14 },
  filterPill: { paddingHorizontal: 15, paddingVertical: 9, borderRadius: 22, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  filterPillActive: { backgroundColor: COLORS.blue, borderColor: COLORS.blue },
  filterText: { color: '#B5C7DC', fontSize: 12, fontWeight: '700' },
  filterTextActive: { color: '#FFFFFF' },
  stateCard: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, padding: 19, alignItems: 'center', gap: 9, backgroundColor: COLORS.surface, marginBottom: 12 },
  stateTitle: { color: COLORS.text, fontSize: 16, fontWeight: '800', textAlign: 'center' },
  retryButton: { backgroundColor: COLORS.blue, borderRadius: 9, paddingHorizontal: 17, paddingVertical: 9, marginTop: 3 },
  retryText: { color: '#FFFFFF', fontWeight: '800' },
  articleCard: { flexDirection: 'row', gap: 12, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: '#183551', borderRadius: 15, padding: 10, marginBottom: 11 },
  articleImage: { width: 106, height: 124, borderRadius: 10, backgroundColor: COLORS.surfaceLight },
  articleImageFallback: { width: 106, height: 124, borderRadius: 10, backgroundColor: '#103C63', alignItems: 'center', justifyContent: 'center' },
  fallbackGlyph: { color: '#45C4FF', fontSize: 42, fontWeight: '900' },
  articleCopy: { flex: 1, justifyContent: 'center' },
  articleTopline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 5, marginBottom: 7 },
  articleTag: { color: '#77DCD0', backgroundColor: '#123C47', overflow: 'hidden', borderRadius: 5, paddingHorizontal: 7, paddingVertical: 4, fontSize: 9, fontWeight: '900' },
  articleTagPurple: { color: '#C9A9FF', backgroundColor: '#32264E' },
  articleTime: { color: COLORS.muted, fontSize: 9, flexShrink: 1, textAlign: 'right' },
  articleTitle: { color: COLORS.text, fontSize: 14, fontWeight: '800', lineHeight: 19, marginBottom: 6 },
  articleSummary: { color: '#9AB0C9', fontSize: 10, lineHeight: 15 },
  articleBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 7 },
  readMore: { color: COLORS.blueLight, fontSize: 10, fontWeight: '800' },
  bookmark: { color: COLORS.text, fontSize: 18 },
  bottomNav: { flexDirection: 'row', backgroundColor: '#07182A', borderTopWidth: 1, borderTopColor: '#1B3550', paddingTop: 8, paddingBottom: 5, paddingHorizontal: 8 },
  navItem: { flex: 1, alignItems: 'center', gap: 2 },
  navIcon: { color: '#91A8C1', fontSize: 23, fontWeight: '700' },
  navLabel: { color: '#8CA2BB', fontSize: 10, fontWeight: '700' },
  navActive: { color: COLORS.blueLight },
  navDot: { height: 3, width: 12, borderRadius: 2, backgroundColor: 'transparent', marginTop: 2 },
  navDotActive: { backgroundColor: COLORS.blue, width: 18 },
  detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 15, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  backButton: { width: 65, minHeight: 44, justifyContent: 'center' },
  backText: { color: COLORS.blueLight, fontSize: 15, fontWeight: '700' },
  detailBrand: { color: COLORS.text, fontWeight: '800', fontSize: 16 },
  detailContent: { padding: 18, paddingBottom: 35 },
  insightPanel: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 15, padding: 15, marginTop: 18, gap: 10 },
  sourceLink: { marginTop: 12, padding: 12, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10 },
  insightTitle: { color: COLORS.text, fontSize: 17, fontWeight: '900' },
  insightSubheading: { color: COLORS.blueLight, fontSize: 13, fontWeight: '900', marginTop: 6 },
  insightBullet: { color: '#D0DDEC', fontSize: 13, lineHeight: 20 },
  insightTerm: { color: COLORS.text, fontWeight: '900' },
  insightSource: { color: COLORS.blueLight, fontSize: 11, lineHeight: 17 },
  insightError: { color: '#FF9E9E', fontSize: 12, lineHeight: 18 },
  relatedStory: { borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 10, gap: 5 },
  relatedTitle: { color: COLORS.text, fontSize: 13, fontWeight: '800', lineHeight: 19 },
  topicPanel: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, padding: 14, marginBottom: 15, gap: 8 },
  topicTitle: { color: COLORS.text, fontSize: 15, fontWeight: '900' },
  topicChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 3 },
  plansContent: { padding: 18, paddingBottom: 38 },
  plansHero: { backgroundColor: '#0C2B4C', borderWidth: 1, borderColor: COLORS.border, borderRadius: 20, padding: 20, marginBottom: 17, gap: 10 },
  plansTitle: { color: COLORS.text, fontSize: 25, fontWeight: '900', lineHeight: 31, marginBottom: 7 },
  activePlanCard: { backgroundColor: '#103A30', borderWidth: 1, borderColor: '#1E8C6A', borderRadius: 14, padding: 15, marginBottom: 16, gap: 5 },
  activePlanTitle: { color: '#7DF0C2', fontSize: 15, fontWeight: '800' },
  cycleToggle: { flexDirection: 'row', backgroundColor: COLORS.surface, borderRadius: 13, padding: 4, marginBottom: 15, borderWidth: 1, borderColor: COLORS.border },
  cycleButton: { flex: 1, paddingVertical: 11, alignItems: 'center', borderRadius: 10 },
  cycleButtonActive: { backgroundColor: COLORS.blue },
  cycleText: { color: COLORS.muted, fontSize: 12, fontWeight: '800' },
  cycleTextActive: { color: '#FFFFFF' },
  planCard: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 18, padding: 17, marginBottom: 14 },
  planCardSelected: { borderColor: '#E8BE50', borderWidth: 2 },
  planTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 7, marginBottom: 14 },
  planName: { color: COLORS.text, fontSize: 20, fontWeight: '900' },
  planPrice: { color: '#FFD56A', fontSize: 17, fontWeight: '900' },
  planFeature: { color: '#C8D8E9', fontSize: 13, lineHeight: 22, marginBottom: 5 },
  paymentMethod: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 15, padding: 17, marginVertical: 15, gap: 8 },
  paymentMethodTitle: { color: COLORS.text, fontSize: 16, fontWeight: '800' },
  notificationCard: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, padding: 15, marginBottom: 11, gap: 7 },
  notificationTitle: { color: COLORS.text, fontSize: 15, fontWeight: '800', lineHeight: 21 },
  detailImage: { width: '100%', height: 220, borderRadius: 15, marginBottom: 18, backgroundColor: COLORS.surface },
  categoryLabel: { color: COLORS.blueLight, fontSize: 11, fontWeight: '900', letterSpacing: 1, marginBottom: 9 },
  detailTitle: { color: COLORS.text, fontSize: 27, fontWeight: '900', lineHeight: 34, marginBottom: 12 },
  articleMeta: { color: COLORS.muted, fontSize: 12, marginBottom: 22 },
  articleBody: { color: '#D0DDEC', fontSize: 16, lineHeight: 27 },
})
