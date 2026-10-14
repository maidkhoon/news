import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Image, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import { supabase } from '../lib/supabase'

type AdminArticle = { id: string; title: string; content?: string; image_url?: string | null; category_id?: string; status: string; access_type: string; updated_at?: string; categories?: { name?: string } | null }
type AdminCategory = { id: string; name: string; slug: string }
type AdminUser = { id: string; name?: string | null; email?: string | null; role?: string | null; status?: boolean | null; subscription?: { id?: string; plan_type?: string; status?: string; expiry_date?: string; active?: boolean } | null }
type Props = { apiBase: string; accessToken: string; onClose: () => void; onSignOut: () => void }

const palette = { bg: '#07111F', panel: '#101F31', border: '#20344B', text: '#F3F7FC', muted: '#9BAEC3', blue: '#3988F5', gold: '#F1C75B', green: '#5AD5A0', red: '#FF8A8A' }

export default function AdminDashboard({ apiBase, accessToken, onClose, onSignOut }: Props) {
  const [tab, setTab] = useState<'Overview' | 'Articles' | 'Categories' | 'Users' | 'Profile'>('Overview')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [adminName, setAdminName] = useState('Administrator')
  const [masterAdmin, setMasterAdmin] = useState(false)
  const [articles, setArticles] = useState<AdminArticle[]>([])
  const [categories, setCategories] = useState<AdminCategory[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [categoryName, setCategoryName] = useState('')
  const [editingArticle, setEditingArticle] = useState<AdminArticle | null>(null)
  const [coverImageUri, setCoverImageUri] = useState<string | null>(null)
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null)
  const [coverImageDirty, setCoverImageDirty] = useState(false)
  const [imageProcessing, setImageProcessing] = useState(false)

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const response = await fetch(apiBase + path, {
      ...init,
      headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json', ...(init.headers || {}) },
    })
    const json = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(json.error || 'Newsroom request failed (' + response.status + ').')
    return json
  }, [apiBase, accessToken])

  const refresh = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [profile, articleResult, categoryResult, userResult] = await Promise.all([
        request('/api/admin/me'), request('/api/admin/articles?limit=100'),
        request('/api/admin/categories'), request('/api/admin/users'),
      ])
      setAdminName(profile.data?.name || profile.data?.email || 'Administrator')
      setMasterAdmin(profile.data?.role === 'MASTER_ADMIN')
      setArticles(Array.isArray(articleResult.data) ? articleResult.data : [])
      setCategories(Array.isArray(categoryResult.data) ? categoryResult.data : [])
      setUsers(Array.isArray(userResult.data) ? userResult.data : [])
      setCategoryId(current => current || categoryResult.data?.[0]?.id || '')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load Newsroom.')
    } finally { setLoading(false) }
  }, [request])

  useEffect(() => { void refresh() }, [refresh])

  const chooseCoverImage = async () => {
    if (imageProcessing || busy) return
    setError('')
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
      })
      if (result.canceled || !result.assets?.[0]) return

      const asset = result.assets[0]
      const uri = asset.uri
      const mimeType = asset.mimeType?.toLowerCase()
      const extension = uri.toLowerCase().split('?')[0].split('.').pop()
      const inferredMime = mimeType || (extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : '')
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(inferredMime)) {
        throw new Error('Choose a JPG, PNG or WebP image.')
      }

      setImageProcessing(true)
      let originalSize = asset.fileSize
      if (typeof originalSize !== 'number') {
        const originalBlob = await (await fetch(uri)).blob()
        originalSize = originalBlob.size
      }
      if (originalSize > 10 * 1024 * 1024) {
        throw new Error('The original image must be 10 MB or smaller. Choose a smaller image and try again.')
      }

      const sourceWidth = asset.width || 1600
      const sourceHeight = asset.height || 900
      const scale = Math.min(1, 1600 / Math.max(sourceWidth, sourceHeight))
      const resized = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: Math.max(1, Math.round(sourceWidth * scale)), height: Math.max(1, Math.round(sourceHeight * scale)) } }],
        { compress: 0.78, format: ImageManipulator.SaveFormat.JPEG },
      )
      let processed = resized
      let processedBlob = await (await fetch(processed.uri)).blob()
      if (processedBlob.size > 5 * 1024 * 1024) {
        processed = await ImageManipulator.manipulateAsync(
          resized.uri,
          [],
          { compress: 0.55, format: ImageManipulator.SaveFormat.JPEG },
        )
        processedBlob = await (await fetch(processed.uri)).blob()
      }
      if (processedBlob.size > 5 * 1024 * 1024) {
        throw new Error('The resized image is still over 5 MB. Please choose a simpler or smaller image.')
      }

      setCoverImageUri(processed.uri)
      setCoverImageDirty(true)
      Alert.alert('Cover image ready', 'The image was resized to fit within 1600 × 1600 pixels and compressed. It will upload when you save the article.')
    } catch (e) {
      Alert.alert('Image selection failed', e instanceof Error ? e.message : 'Please choose another image.')
    } finally {
      setImageProcessing(false)
    }
  }

  const uploadCoverImage = async (uri: string) => {
    const blob = await (await fetch(uri)).blob()
    if (blob.size > 5 * 1024 * 1024) throw new Error('Processed cover images must be 5 MB or smaller.')
    const objectPath = 'covers/' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.jpg'
    const { error: uploadError } = await supabase.storage.from('article-images').upload(objectPath, blob, {
      contentType: 'image/jpeg',
      cacheControl: '3600',
      upsert: false,
    })
    if (uploadError) throw uploadError
    return supabase.storage.from('article-images').getPublicUrl(objectPath).data.publicUrl
  }

  const resetArticleEditor = () => {
    setEditingArticle(null)
    setTitle('')
    setBody('')
    setCoverImageUri(null)
    setCoverImageUrl(null)
    setCoverImageDirty(false)
  }

  const openArticleEditor = (article?: AdminArticle) => {
    setError('')
    setEditingArticle(article || null)
    setTitle(article?.title || '')
    setBody(article?.content || '')
    setCategoryId(article?.category_id || categories[0]?.id || '')
    setCoverImageUri(null)
    setCoverImageUrl(article?.image_url || null)
    setCoverImageDirty(false)
    setTab('Articles')
  }

  const createArticle = async (status: 'DRAFT' | 'PUBLISHED') => {
    if (!title.trim() || !body.trim() || !categoryId) {
      Alert.alert('Missing details', 'Add a title, article content and category first.')
      return
    }
    setBusy(true)
    try {
      let imageUrl = coverImageUrl
      if (coverImageDirty) imageUrl = coverImageUri ? await uploadCoverImage(coverImageUri) : null
      const articleFields = {
        title: title.trim(),
        content: body.trim(),
        category_id: categoryId,
        image_url: imageUrl,
      }
      if (editingArticle) {
        // Do not resend status while editing a published article: the backend treats
        // status=PUBLISHED as a publish action and would send a duplicate notification.
        await request('/api/admin/articles/' + encodeURIComponent(editingArticle.id), {
          method: 'PATCH',
          body: JSON.stringify(articleFields),
        })
      } else {
        await request('/api/admin/articles', {
          method: 'POST',
          body: JSON.stringify({ ...articleFields, status, access_type: 'FREE' }),
        })
      }
      resetArticleEditor()
      await refresh()
      Alert.alert(
        editingArticle ? 'Article updated' : status === 'DRAFT' ? 'Draft saved' : 'Article published',
        editingArticle ? 'Article details and cover image were saved.' : status === 'DRAFT' ? 'The article was saved as a draft.' : 'The article was published.',
      )
    } catch (e) {
      Alert.alert('Could not save article', e instanceof Error ? e.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const changeStatus = async (article: AdminArticle, status: 'DRAFT' | 'PUBLISHED') => {
    setBusy(true)
    try { await request('/api/admin/articles/' + encodeURIComponent(article.id), { method: 'PATCH', body: JSON.stringify({ status }) }); await refresh() }
    catch (e) { Alert.alert('Article update failed', e instanceof Error ? e.message : 'Please try again.') }
    finally { setBusy(false) }
  }

  const createCategory = async () => {
    if (!categoryName.trim()) return
    setBusy(true)
    try { await request('/api/admin/categories', { method: 'POST', body: JSON.stringify({ name: categoryName.trim() }) }); setCategoryName(''); await refresh() }
    catch (e) { Alert.alert('Category creation failed', e instanceof Error ? e.message : 'Please try again.') }
    finally { setBusy(false) }
  }

  const changeRole = async (user: AdminUser, role: 'ADMIN' | 'USER') => {
    const action = role === 'ADMIN' ? 'assign admin access to' : 'remove admin access from'
    Alert.alert('Confirm role change', `Are you sure you want to ${action} ${user.name || user.email || 'this user'}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: () => {
        setBusy(true)
        void request('/api/admin/users/' + encodeURIComponent(user.id) + '/role', {
          method: 'PATCH', body: JSON.stringify({ role })
        }).then(() => refresh()).catch(e => Alert.alert('Role update failed', e instanceof Error ? e.message : 'Please try again.')).finally(() => setBusy(false))
      } }
    ])
  }

  const assignPlan = async (user: AdminUser, planType: 'BASIC_MONTHLY' | 'BASIC_YEARLY' | 'PRO_MONTHLY' | 'PRO_YEARLY', days: number) => {
    Alert.alert('Confirm plan assignment', `Assign ${planType.replace('_', ' ')} to ${user.name || user.email || 'this user'} for ${days} days? This is a manual entitlement and does not charge Google Play.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Assign plan', onPress: () => {
        const expiry = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
        setBusy(true)
        void request('/api/admin/users/' + encodeURIComponent(user.id) + '/plan', {
          method: 'POST', body: JSON.stringify({ plan_type: planType, expiry_date: expiry })
        }).then(() => refresh()).catch(e => Alert.alert('Plan assignment failed', e instanceof Error ? e.message : 'Please try again.')).finally(() => setBusy(false))
      } }
    ])
  }

  const removePlan = (user: AdminUser) => {
    Alert.alert('Remove paid plan?', `Move ${user.name || user.email || 'this user'} to Free access? This does not cancel any Google Play subscription.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove plan', style: 'destructive', onPress: () => {
        setBusy(true)
        void request('/api/admin/users/' + encodeURIComponent(user.id) + '/free-plan', {
          method: 'POST', body: JSON.stringify({})
        }).then(() => refresh()).catch(e => Alert.alert('Plan removal failed', e instanceof Error ? e.message : 'Please try again.')).finally(() => setBusy(false))
      } }
    ])
  }

  const stat = (label: string, value: number, accent: string) => <View key={label} style={styles.stat}><Text style={[styles.statValue, { color: accent }]}>{value}</Text><Text style={styles.muted}>{label}</Text></View>
  const button = (label: string, onPress: () => void, secondary = false) => <Pressable key={label} disabled={busy} onPress={onPress} style={[styles.button, secondary && styles.secondaryButton, busy && { opacity: 0.6 }]}><Text style={[styles.buttonText, secondary && { color: palette.text }]}>{label}</Text></Pressable>

  return <SafeAreaView style={styles.screen}>
    <StatusBar barStyle="light-content" backgroundColor={palette.bg} />
    <View style={styles.header}>
      <View style={styles.brandIcon}><Text style={styles.brandLetter}>N</Text></View>
      <View style={{ flex: 1 }}><Text style={styles.brand}>BazaarNexa <Text style={{ color: palette.gold }}>Newsroom</Text></Text><Text style={styles.muted}>ADMIN CONSOLE · {adminName}</Text></View>
      <View style={styles.headerActions}>
        <Pressable onPress={onClose} style={[styles.signOut, styles.appSwitch]} accessibilityRole="button" accessibilityLabel="Return to user app"><Text style={styles.signOutText}>User app</Text></Pressable>
        <Pressable onPress={onSignOut} style={styles.signOut}><Text style={styles.signOutText}>Sign out</Text></Pressable>
      </View>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs} contentContainerStyle={{ gap: 8 }}>
      {(['Overview', 'Articles', 'Categories', 'Users', 'Profile'] as const).map(item => <Pressable key={item} onPress={() => setTab(item)} style={[styles.tab, tab === item && styles.activeTab]}><Text style={[styles.tabText, tab === item && styles.activeTabText]}>{item}</Text></Pressable>)}
    </ScrollView>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.heading}>{tab === 'Overview' ? 'Newsroom dashboard' : tab}</Text>
      <Text style={styles.muted}>Manage BazaarNexa news content from your phone.</Text>
      {loading ? <View style={styles.center}><ActivityIndicator size="large" color={palette.blue} /><Text style={styles.muted}>Loading newsroom…</Text></View> : error ? <View style={styles.notice}><Text style={{ color: palette.red, fontWeight: '700' }}>Unable to load dashboard</Text><Text style={styles.muted}>{error}</Text>{button('Retry', () => void refresh())}</View> : <>
        {tab === 'Overview' && <>
          <View style={styles.stats}>{stat('Articles', articles.length, palette.blue)}{stat('Published', articles.filter(a => a.status === 'PUBLISHED').length, palette.green)}{stat('Drafts', articles.filter(a => a.status === 'DRAFT').length, palette.gold)}{stat('Users', users.length, '#C4A4FF')}</View>
          <Text style={styles.sectionTitle}>Recent articles</Text>
          {articles.slice(0, 6).map(article => <View key={article.id} style={styles.card}><Text style={styles.cardTitle}>{article.title}</Text><Text style={styles.muted}>{article.categories?.name || 'Uncategorized'} · {article.status} · {article.access_type}</Text></View>)}
          {button('Manage articles', () => openArticleEditor())}
        </>}
        {tab === 'Articles' && <>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{editingArticle ? 'Edit article' : 'Create article'}</Text>
            <TextInput value={title} onChangeText={setTitle} placeholder="Article headline" placeholderTextColor={palette.muted} style={styles.input} maxLength={240} />
            <TextInput value={body} onChangeText={setBody} placeholder="Write article content…" placeholderTextColor={palette.muted} style={[styles.input, styles.multiline]} multiline textAlignVertical="top" />
            <Text style={styles.fieldLabel}>Cover image</Text>
            {(coverImageUri || coverImageUrl) ? <View style={styles.coverPreviewWrap}>
              <Image source={{ uri: coverImageUri || coverImageUrl || undefined }} style={styles.coverPreview} resizeMode="cover" />
              <Text style={styles.muted}>{coverImageDirty ? 'New resized image · will upload when saved' : 'Current article cover image'}</Text>
              <View style={styles.actions}>
                {button('Replace image', () => void chooseCoverImage(), true)}
                {button('Remove image', () => { setCoverImageUri(null); setCoverImageUrl(null); setCoverImageDirty(true) }, true)}
              </View>
            </View> : <Text style={styles.muted}>Add a JPG, PNG or WebP cover image. Images are resized before upload.</Text>}
            {button(imageProcessing ? 'Processing image…' : 'Choose cover image', () => void chooseCoverImage(), true)}
            <Text style={styles.muted}>Original limit: 10 MB. Resized output: max 1600 × 1600 pixels and 5 MB.</Text>
            <Text style={styles.fieldLabel}>Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {categories.map(category => <Pressable key={category.id} onPress={() => setCategoryId(category.id)} style={[styles.tab, categoryId === category.id && styles.activeTab]}><Text style={[styles.tabText, categoryId === category.id && styles.activeTabText]}>{category.name}</Text></Pressable>)}
            </ScrollView>
            <View style={styles.actions}>{editingArticle ? button('Save changes', () => void createArticle(editingArticle.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT')) : <>{button('Save draft', () => void createArticle('DRAFT'), true)}{button('Publish', () => Alert.alert('Publish article?', 'This makes the article visible to readers.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Publish', onPress: () => void createArticle('PUBLISHED') }]))}</>}{editingArticle && button('Cancel edit', resetArticleEditor, true)}</View>
          </View>
          <Text style={styles.sectionTitle}>All articles</Text>
          {articles.map(article => <View key={article.id} style={styles.card}>{article.image_url ? <Image source={{ uri: article.image_url }} style={styles.articleThumbnail} resizeMode="cover" /> : null}<Text style={styles.cardTitle}>{article.title}</Text><Text style={styles.muted}>{article.categories?.name || 'Uncategorized'} · {article.status} · {article.access_type}</Text><View style={styles.actions}><Pressable onPress={() => openArticleEditor(article)} disabled={busy} style={[styles.button, styles.secondaryButton]}><Text style={styles.buttonText}>Edit article</Text></Pressable>{article.status === 'PUBLISHED' ? button('Unpublish', () => void changeStatus(article, 'DRAFT'), true) : button('Publish', () => Alert.alert('Publish article?', 'This makes the article visible to readers.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Publish', onPress: () => void changeStatus(article, 'PUBLISHED') }]))}</View></View>)}
        </>}
        {tab === 'Categories' && <>
          <View style={styles.card}><Text style={styles.sectionTitle}>Add category</Text><TextInput value={categoryName} onChangeText={setCategoryName} placeholder="Category name" placeholderTextColor={palette.muted} style={styles.input} maxLength={80} />{button('Create category', () => void createCategory())}</View>
          {categories.map(category => <View key={category.id} style={styles.card}><Text style={styles.cardTitle}>{category.name}</Text><Text style={styles.muted}>/{category.slug}</Text></View>)}
        </>}
        {tab === 'Users' && users.map(user => <View key={user.id} style={styles.card}>
          <Text style={styles.cardTitle}>{user.name || user.email || 'BazaarNexa user'}</Text>
          <Text style={styles.muted}>{user.email || 'No email'} · {user.role || 'USER'} · {user.status ? 'Active' : 'Disabled'}</Text>
          <Text style={styles.muted}>Plan: {user.subscription?.plan_type || 'Free'}{user.subscription?.expiry_date ? ` · expires ${new Date(user.subscription.expiry_date).toLocaleDateString()}` : ''}</Text>
          {masterAdmin && user.role !== 'MASTER_ADMIN' && <>
            <Text style={styles.fieldLabel}>Role permissions</Text>
            <View style={styles.actions}>
              {user.role === 'ADMIN'
                ? button('Remove admin', () => void changeRole(user, 'USER'), true)
                : button('Assign admin', () => void changeRole(user, 'ADMIN'))}
            </View>
            <Text style={styles.fieldLabel}>Subscription controls</Text>
            <View style={styles.actions}>
              {button('Basic 1M', () => void assignPlan(user, 'BASIC_MONTHLY', 30), true)}
              {button('Basic 1Y', () => void assignPlan(user, 'BASIC_YEARLY', 365), true)}
              {button('Pro 1M', () => void assignPlan(user, 'PRO_MONTHLY', 30), true)}
              {button('Pro 1Y', () => void assignPlan(user, 'PRO_YEARLY', 365), true)}
              {button('Remove plan', () => removePlan(user), true)}
            </View>
          </>}
        </View>)}
        {tab === 'Profile' && <View style={styles.card}><Text style={styles.sectionTitle}>Administrator profile</Text><Text style={styles.cardTitle}>{adminName}</Text><Text style={styles.muted}>Your administrator role is verified by the BazaarNexa backend. Admin API requests require your current Supabase session.</Text>{button('Refresh profile', () => void refresh(), true)}{button('Sign out', onSignOut)}</View>}
        <Pressable onPress={() => void refresh()} style={styles.refresh}><Text style={styles.refreshText}>↻  Refresh newsroom data</Text></Pressable>
      </>}
    </ScrollView>
  </SafeAreaView>
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: palette.border },
  brandIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#0E604D', alignItems: 'center', justifyContent: 'center' },
  brandLetter: { color: '#FFFFFF', fontSize: 21, fontWeight: '900' },
  brand: { color: palette.text, fontSize: 17, fontWeight: '900' },
  muted: { color: palette.muted, fontSize: 12, lineHeight: 18 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  appSwitch: { backgroundColor: '#123B34', borderColor: '#276E5A' },
  signOut: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: palette.border },
  signOutText: { color: palette.text, fontSize: 12, fontWeight: '800' },
  tabs: { maxHeight: 54, borderBottomWidth: 1, borderBottomColor: palette.border },
  tab: { borderWidth: 1, borderColor: palette.border, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 10 },
  activeTab: { backgroundColor: '#173A5F', borderColor: palette.blue },
  tabText: { color: palette.muted, fontSize: 12, fontWeight: '700' },
  activeTabText: { color: '#FFFFFF' },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  heading: { color: palette.text, fontSize: 25, fontWeight: '900', marginTop: 5 },
  center: { padding: 35, alignItems: 'center', gap: 12 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginVertical: 8 },
  stat: { flexGrow: 1, flexBasis: '45%', backgroundColor: palette.panel, borderWidth: 1, borderColor: palette.border, borderRadius: 15, padding: 16, gap: 4 },
  statValue: { fontSize: 27, fontWeight: '900' },
  card: { backgroundColor: palette.panel, borderWidth: 1, borderColor: palette.border, borderRadius: 15, padding: 14, gap: 9, marginTop: 4 },
  cardTitle: { color: palette.text, fontSize: 15, fontWeight: '800' },
  sectionTitle: { color: palette.text, fontSize: 17, fontWeight: '900', marginTop: 8 },
  input: { backgroundColor: '#081624', borderColor: palette.border, borderWidth: 1, borderRadius: 11, color: palette.text, padding: 12, fontSize: 14 },
  coverPreviewWrap: { gap: 8, backgroundColor: '#081624', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: palette.border },
  coverPreview: { width: '100%', height: 190, borderRadius: 9, backgroundColor: palette.bg },
  articleThumbnail: { width: '100%', height: 150, borderRadius: 10, backgroundColor: palette.bg },
  multiline: { minHeight: 140, maxHeight: 280 },
  fieldLabel: { color: palette.muted, fontSize: 12, fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  button: { backgroundColor: palette.blue, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  secondaryButton: { backgroundColor: 'transparent', borderWidth: 1, borderColor: palette.border },
  buttonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  notice: { backgroundColor: palette.panel, borderRadius: 14, padding: 15, gap: 10 },
  refresh: { padding: 14, alignItems: 'center' },
  refreshText: { color: palette.blue, fontWeight: '800', fontSize: 12 },
})
