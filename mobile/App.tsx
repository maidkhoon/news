import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'

type AuthStep = 'phone' | 'otp'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [initializing, setInitializing] = useState(true)
  const [step, setStep] = useState<AuthStep>('phone')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setInitializing(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })

    return () => subscription.unsubscribe()
  }, [])

  const normalizedPhone = () => {
    const digits = phone.replace(/\D/g, '')
    if (digits.length !== 10) {
      throw new Error('Enter a valid 10-digit mobile number.')
    }
    return `+91${digits}`
  }

  const sendOtp = async () => {
    try {
      setLoading(true)
      const formattedPhone = normalizedPhone()

      const { error } = await supabase.auth.signInWithOtp({
        phone: formattedPhone,
      })

      if (error) throw error

      setStep('otp')
      setOtp('')
      Alert.alert('OTP sent', `We sent a 6-digit OTP to ${formattedPhone}.`)
    } catch (error) {
      Alert.alert('Unable to send OTP', error instanceof Error ? error.message : 'Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const verifyOtp = async () => {
    try {
      setLoading(true)
      const formattedPhone = normalizedPhone()

      if (!/^\d{6}$/.test(otp)) {
        throw new Error('Enter the 6-digit OTP.')
      }

      const { error } = await supabase.auth.verifyOtp({
        phone: formattedPhone,
        token: otp,
        type: 'sms',
      })

      if (error) throw error
    } catch (error) {
      Alert.alert('OTP verification failed', error instanceof Error ? error.message : 'Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setStep('phone')
    setOtp('')
  }

  if (initializing) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" />
        <Text style={styles.muted}>Loading…</Text>
      </SafeAreaView>
    )
  }

  if (session) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <Text style={styles.brand}>NEWS</Text>
          <Text style={styles.title}>You’re signed in</Text>
          <Text style={styles.subtitle}>{session.user.phone}</Text>

          <View style={styles.homeCard}>
            <Text style={styles.cardTitle}>INDIA</Text>
            <Text style={styles.cardText}>Indian news and research will appear here.</Text>
          </View>

          <View style={styles.homeCard}>
            <Text style={styles.cardTitle}>CRYPTO</Text>
            <Text style={styles.cardText}>Crypto news and research will appear here.</Text>
          </View>

          <Pressable style={styles.secondaryButton} onPress={signOut}>
            <Text style={styles.secondaryButtonText}>Sign out</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.content}>
          <Text style={styles.brand}>NEWS</Text>
          <Text style={styles.title}>{step === 'phone' ? 'Welcome' : 'Verify your number'}</Text>
          <Text style={styles.subtitle}>
            {step === 'phone'
              ? 'Sign in with your mobile number to continue.'
              : `Enter the OTP sent to +91 ${phone}.`}
          </Text>

          {step === 'phone' ? (
            <>
              <View style={styles.phoneRow}>
                <View style={styles.countryCode}>
                  <Text style={styles.countryCodeText}>+91</Text>
                </View>
                <TextInput
                  value={phone}
                  onChangeText={(value) => setPhone(value.replace(/\D/g, '').slice(0, 10))}
                  keyboardType="phone-pad"
                  placeholder="Mobile number"
                  maxLength={10}
                  style={styles.input}
                  editable={!loading}
                />
              </View>

              <Pressable style={styles.primaryButton} onPress={sendOtp} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Send OTP</Text>}
              </Pressable>
            </>
          ) : (
            <>
              <TextInput
                value={otp}
                onChangeText={(value) => setOtp(value.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                placeholder="6-digit OTP"
                maxLength={6}
                style={[styles.input, styles.otpInput]}
                editable={!loading}
                autoFocus
              />

              <Pressable style={styles.primaryButton} onPress={verifyOtp} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Verify OTP</Text>}
              </Pressable>

              <Pressable
                style={styles.secondaryButton}
                onPress={() => {
                  setStep('phone')
                  setOtp('')
                }}
                disabled={loading}
              >
                <Text style={styles.secondaryButtonText}>Change number</Text>
              </Pressable>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#ffffff',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  brand: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 3,
    marginBottom: 18,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 23,
    color: '#666666',
    marginBottom: 28,
  },
  muted: {
    color: '#666666',
  },
  phoneRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  countryCode: {
    height: 54,
    borderWidth: 1,
    borderColor: '#dddddd',
    borderRadius: 12,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  countryCodeText: {
    fontSize: 16,
    fontWeight: '600',
  },
  input: {
    height: 54,
    flex: 1,
    borderWidth: 1,
    borderColor: '#dddddd',
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 17,
    backgroundColor: '#ffffff',
  },
  otpInput: {
    flex: 0,
    width: '100%',
    textAlign: 'center',
    letterSpacing: 8,
    marginBottom: 14,
  },
  primaryButton: {
    height: 54,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111111',
    marginBottom: 12,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    height: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#dddddd',
    marginBottom: 12,
  },
  secondaryButtonText: {
    color: '#222222',
    fontSize: 15,
    fontWeight: '600',
  },
  homeCard: {
    borderWidth: 1,
    borderColor: '#e5e5e5',
    borderRadius: 16,
    padding: 18,
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 5,
  },
  cardText: {
    color: '#666666',
    lineHeight: 21,
  },
})
