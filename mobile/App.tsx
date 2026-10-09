import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'

type AuthStep = 'phone' | 'otp'
type Category = { id: string; name: string; slug: string }
type Article = {
  id: string
  title: string
  slug: string
  image_url?: string | null
  access_type?: string
  status?: string
  published_at?: string | null
  content?: string
  categories?: { name?: string; slug?: string } | null
}
type Tab = 'Home' | 'Crypto' | 'Sensex' | 'Nifty 50'

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL || 'https://news-api-egmd.onrender.com').replace(/\/$/, '')
const NAV_TABS: Tab[] = ['Home', 'Crypto', 'Sensex', 'Nifty 50']
const FILTERS = ['All', 'India', 'Nifty 50', 'Sensex', 'Crypto']

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
  const [categories, setCategories] = useState<Category[]>([])
  const [articles, setArticles] = useState<Article[]>([])
  const [feedLoading, setFeedLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [feedError, setFeedError] = useState('')
  const [filter, setFilter] = useState('All')
  const [tab, setTab] = useState<Tab>('Home')
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null)
  const [savedIds, setSavedIds] = useState<string[]>([])

  useEffect(() => {
    AsyncStorage.getItem(SAVED_STORAGE_KEY).then(value => {
      if (value) {
        const parsed = JSON.parse(value)
        if (Array.isArray(parsed)) setSavedIds(parsed.filter(id => typeof id === 'string'))
      }
    }).catch(() => undefined)

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
    try {
      setAuthLoading(true)
      const formattedPhone = normalizedPhone()
      const { error } = await supabase.auth.signInWithOtp({ phone: formattedPhone })
      if (error) throw error
      setStep('otp')
      setOtp('')
      Alert.alert('OTP sent', `We sent a 6-digit OTP to ${formattedPhone}.`)
    } catch (error) {
      Alert.alert('Unable to send OTP', error instanceof Error ? error.message : 'Please try again.')
    } finally {
      setAuthLoading(false)
    }
  }

  const verifyOtp = async () => {
    try {
      setAuthLoading(true)
      const formattedPhone = normalizedPhone()
      if (!/^\d{6}$/.test(otp)) throw new Error('Enter the 6-digit OTP.')
      const { error } = await supabase.auth.verifyOtp({ phone: formattedPhone, token: otp, type: 'sms' })
      if (error) throw error
    } catch (error) {
      Alert.alert('OTP verification failed', error instanceof Error ? error.message : 'Please try again.')
    } finally {
      setAuthLoading(false)
    }
  }

  const loadFeed = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setFeedLoading(true)
    setFeedError('')
    try {
      const [categoryResponse, articleResponse] = await Promise.all([
        fetch(`${API_BASE}/api/categories`),
        fetch(`${API_BASE}/api/articles?limit=30`),
      ])
      if (!categoryResponse.ok || !articleResponse.ok) throw new Error('The newsroom service is temporarily unavailable.')
      const categoryJson = await categoryResponse.json()
      const articleJson = await articleResponse.json()
      setCategories(Array.isArray(categoryJson.data) ? categoryJson.data : [])
      setArticles(Array.isArray(articleJson.data) ? articleJson.data : [])
    } catch (error) {
      setFeedError(error instanceof Error ? error.message : 'Unable to load research.')
    } finally {
      setFeedLoading(false)
      setRefreshing(false)
    }
  }, [])

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

  useEffect(() => {
    if (session) {
      loadFeed()
      loadMemberData(session.access_token)
      void registerPushDevice(session.access_token)
    } else {
      setActiveSubscription(null)
    }
  }, [session, loadFeed, loadMemberData, registerPushDevice])

  useEffect(() => {
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data
      const slug = typeof data?.articleSlug === 'string' ? data.articleSlug : ''
      if (!slug) return
      setScreen('home')
      fetch(`${API_BASE}/api/articles/${encodeURIComponent(slug)}`)
        .then(async response => {
          const json = await response.json()
          if (response.ok && json.data) setSelectedArticle(json.data)
          else if (response.status === 403) Alert.alert('Premium research', 'An active subscription is required to read this article.')
        })
        .catch(() => Alert.alert('Article unavailable', 'Please open BazaarNexa and try again.'))
    })
    return () => responseSubscription.remove()
  }, [])

  useEffect(() => {
    AsyncStorage.setItem(SAVED_STORAGE_KEY, JSON.stringify(savedIds)).catch(() => undefined)
  }, [savedIds])

  const openArticle = async (article: Article) => {
    setSelectedArticle(article)
    try {
      const response = await fetch(`${API_BASE}/api/articles/${encodeURIComponent(article.slug)}`)
      const json = await response.json()
      if (response.status === 403 || json.error === 'PREMIUM_REQUIRED') {
        Alert.alert('Premium research', 'An active BazaarNexa subscription is required to read this report.', [{ text: 'Not now' }, { text: 'View plans', onPress: () => setScreen('plans') }])
        return
      }
      if (response.ok && json.data) setSelectedArticle(json.data)
    } catch {
      // Keep the article card data available if the detail request fails.
    }
  }

  const visibleArticles = useMemo(() => {
    let result = articles
    const chosen = tab === 'Crypto' ? 'Crypto' : tab === 'Sensex' || tab === 'Nifty 50' ? tab : filter
    if (chosen === 'Crypto') result = result.filter(a => a.categories?.slug?.toLowerCase().includes('crypto') || a.categories?.name?.toLowerCase().includes('crypto'))
    else if (chosen === 'India') result = result.filter(a => a.categories?.slug?.toLowerCase().includes('india') || a.categories?.name?.toLowerCase().includes('india'))
    else if (chosen === 'Sensex' || chosen === 'Nifty 50') result = result.filter(a => a.title.toLowerCase().includes(chosen.toLowerCase()) || a.categories?.name?.toLowerCase().includes('india'))
    if (search.trim()) result = result.filter(a => a.title.toLowerCase().includes(search.trim().toLowerCase()))
    return result
  }, [articles, filter, tab, search])

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

  if (initializing) {
    return <SafeAreaView style={styles.loadingScreen}><StatusBar barStyle="light-content" backgroundColor={COLORS.background} /><ActivityIndicator color={COLORS.blue} size="large" /><Text style={styles.muted}>Preparing BazaarNexa…</Text></SafeAreaView>
  }

  if (!session) {
    return (
      <SafeAreaView style={styles.authScreen}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
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
          {step === 'otp' && <Pressable style={styles.textButton} onPress={() => { setStep('phone'); setOtp('') }}><Text style={styles.linkText}>Change mobile number</Text></Pressable>}
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
          <Pressable onPress={() => setSelectedArticle(null)} style={styles.backButton}><Text style={styles.backText}>‹  Back</Text></Pressable>
          <Text style={styles.detailBrand}>BazaarNexa</Text>
          <View style={{ width: 48 }} />
        </View>
        <ScrollView contentContainerStyle={styles.detailContent}>
          {selectedArticle.image_url ? <Image source={{ uri: selectedArticle.image_url }} style={styles.detailImage} resizeMode="cover" /> : null}
          <Text style={styles.categoryLabel}>{selectedArticle.categories?.name || 'RESEARCH'}</Text>
          <Text style={styles.detailTitle}>{selectedArticle.title}</Text>
          <Text style={styles.articleMeta}>{readableDate(selectedArticle.published_at)}  ·  {selectedArticle.access_type === 'PREMIUM' ? 'Premium' : 'Free'}</Text>
          <Text style={styles.articleBody}>{selectedArticle.content || 'The full article content is not available yet.'}</Text>
          <Text style={styles.disclaimer}>For research and educational purposes only. Not investment advice.</Text>
        </ScrollView>
      </SafeAreaView>
    )
  }

  if (screen === 'plans' || screen === 'payment') {
    const basicPrice = planCycle === 'monthly' ? '₹499 / month' : '₹3,599 / year'
    const proPrice = planCycle === 'monthly' ? '₹999 / month' : '₹7,199 / year'
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
              <View style={styles.stateCard}>
                <Text style={styles.stateTitle}>Billing setup required</Text>
                <Text style={styles.muted}>The secure server-side purchase verification endpoint is ready. Before purchases can be enabled, the app needs registered subscription products in Play Console, the native billing client, and Google Play service-account credentials.</Text>
              </View>
              <Pressable onPress={() => Alert.alert('Not yet enabled', 'No payment has been taken. Configure the Google Play subscription products and native billing client before enabling checkout.')} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Checkout unavailable until setup</Text></Pressable>
              <Text style={styles.disclaimer}>No payment will be taken from this screen yet.</Text>
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
          {notificationsLoading ? <ActivityIndicator color={COLORS.blue} size="large" /> : null}
          {!notificationsLoading && notificationItems.length === 0 ? <View style={styles.stateCard}><Text style={styles.stateTitle}>You're all caught up</Text><Text style={styles.muted}>When new research is published, notifications will appear here and on your device when push notifications are configured.</Text></View> : null}
          {notificationItems.map(item => (
            <Pressable key={item.id} style={styles.notificationCard} onPress={() => {
              const slug = item.articles?.slug
              if (!slug) return
              fetch(`${API_BASE}/api/articles/${encodeURIComponent(slug)}`).then(async response => {
                const json = await response.json()
                if (response.ok && json.data) { setSelectedArticle(json.data); setScreen('home') }
                else if (response.status === 403) Alert.alert('Premium research', 'An active subscription is required.', [{ text: 'Cancel' }, { text: 'View plans', onPress: () => setScreen('plans') }])
              }).catch(() => Alert.alert('Unavailable', 'Please try again later.'))
            }}>
              <Text style={styles.notificationTitle}>{item.title}</Text>
              <Text style={styles.muted}>{item.message}</Text>
              <Text style={styles.articleTime}>{readableDate(item.created_at)}</Text>
            </Pressable>
          ))}
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
      <View style={styles.header}>
        <View style={styles.brandMark}><Text style={styles.brandMarkText}>↗</Text></View>
        <View style={styles.headerCopy}><Text style={styles.headerTitle}>Bazaar<Text style={styles.wordmarkBlue}>Nexa</Text></Text><Text style={styles.headerSub}>INDIA & CRYPTO RESEARCH</Text></View>
        <Pressable onPress={() => { setSearchOpen(open => !open); setSearch('') }} style={styles.headerIcon}><Text style={styles.headerIconText}>⌕</Text></Pressable>
        <Pressable onPress={() => { setScreen('notifications'); void loadNotifications() }} style={styles.headerIcon}><Text style={styles.headerIconText}>♧</Text></Pressable>
        <Pressable onPress={() => Alert.alert('Account', 'Signed in as ' + (session.user.phone || 'member'), [{ text: 'Close' }, { text: 'Saved articles', onPress: () => setScreen('saved') }, { text: 'Sign out', style: 'destructive', onPress: signOut }])} style={styles.avatar}><Text style={styles.avatarText}>●</Text></Pressable>
      </View>
      {searchOpen ? <View style={styles.searchRow}><TextInput autoFocus value={search} onChangeText={setSearch} placeholder="Search research…" placeholderTextColor={COLORS.muted} style={styles.searchInput} /></View> : null}
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadFeed(true)} tintColor={COLORS.blue} />}
        contentContainerStyle={styles.feedContent}
      >
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
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {FILTERS.map(item => <Pressable key={item} onPress={() => { setFilter(item); setTab(item === 'Crypto' ? 'Crypto' : 'Home') }} style={[styles.filterPill, filter === item && tab === 'Home' && styles.filterPillActive]}><Text style={[styles.filterText, filter === item && tab === 'Home' && styles.filterTextActive]}>{item}</Text></Pressable>)}
        </ScrollView>
        {feedLoading && articles.length === 0 ? <View style={styles.stateCard}><ActivityIndicator color={COLORS.blue} /><Text style={styles.muted}>Loading the newsroom…</Text></View> : null}
        {feedError ? <View style={styles.stateCard}><Text style={styles.stateTitle}>Couldn’t load research</Text><Text style={styles.muted}>{feedError}</Text><Pressable onPress={() => loadFeed()} style={styles.retryButton}><Text style={styles.retryText}>Try again</Text></Pressable></View> : null}
        {!feedLoading && !feedError && visibleArticles.length === 0 ? <View style={styles.stateCard}><Text style={styles.stateTitle}>No articles yet</Text><Text style={styles.muted}>Published articles matching this section will appear here. Pull down to refresh.</Text></View> : null}
        {visibleArticles.map((article, index) => (
          <Pressable key={article.id} onPress={() => openArticle(article)} style={styles.articleCard}>
            {article.image_url ? <Image source={{ uri: article.image_url }} style={styles.articleImage} resizeMode="cover" /> : <View style={styles.articleImageFallback}><Text style={styles.fallbackGlyph}>{article.categories?.slug?.includes('crypto') ? '₿' : '↗'}</Text></View>}
            <View style={styles.articleCopy}>
              <View style={styles.articleTopline}><Text style={[styles.articleTag, index % 3 === 1 && styles.articleTagPurple]}>{article.categories?.name || 'Research'}</Text><Text style={styles.articleTime}>{readableDate(article.published_at)}</Text></View>
              <Text numberOfLines={3} style={styles.articleTitle}>{article.title}</Text>
              <Text numberOfLines={2} style={styles.articleSummary}>In-depth research, key developments and context to help you understand the story.</Text>
              <View style={styles.articleBottom}><Text style={styles.readMore}>Read article  →</Text><Pressable hitSlop={10} onPress={() => setSavedIds(ids => ids.includes(article.id) ? ids.filter(id => id !== article.id) : [...ids, article.id])}><Text style={styles.bookmark}>{savedIds.includes(article.id) ? '🔖' : '♧'}</Text></Pressable></View>
            </View>
          </Pressable>
        ))}
        <Text style={styles.disclaimer}>BazaarNexa provides research and educational information only. Nothing here is a recommendation to buy or sell securities or crypto assets.</Text>
      </ScrollView>
      <View style={styles.bottomNav}>
        {NAV_TABS.map((item, index) => <Pressable key={item} onPress={() => { setScreen('home'); setTab(item); setFilter(item === 'Crypto' ? 'Crypto' : item === 'Home' ? 'All' : item) }} style={styles.navItem}><Text style={[styles.navIcon, tab === item && styles.navActive]}>{['⌂', '₿', '▥', '↗'][index]}</Text><Text style={[styles.navLabel, tab === item && styles.navActive]}>{item}</Text><View style={[styles.navDot, tab === item && styles.navDotActive]} /></Pressable>)}
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
  authScreen: { flex: 1, backgroundColor: COLORS.background, paddingHorizontal: 22, justifyContent: 'center' },
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
  heroImageFallback: { ...StyleSheet.absoluteFillObject, backgroundColor: '#103D68', justifyContent: 'center', alignItems: 'center' },
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
  backButton: { width: 65 },
  backText: { color: COLORS.blueLight, fontSize: 15, fontWeight: '700' },
  detailBrand: { color: COLORS.text, fontWeight: '800', fontSize: 16 },
  detailContent: { padding: 18, paddingBottom: 35 },
  detailImage: { width: '100%', height: 220, borderRadius: 15, marginBottom: 18, backgroundColor: COLORS.surface },
  categoryLabel: { color: COLORS.blueLight, fontSize: 11, fontWeight: '900', letterSpacing: 1, marginBottom: 9 },
  detailTitle: { color: COLORS.text, fontSize: 27, fontWeight: '900', lineHeight: 34, marginBottom: 12 },
  articleMeta: { color: COLORS.muted, fontSize: 12, marginBottom: 22 },
  articleBody: { color: '#D0DDEC', fontSize: 16, lineHeight: 27 },
})
