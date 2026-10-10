import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import "./styles.css";

const API_URL = (import.meta.env.VITE_API_BASE_URL || "https://news-api-egmd.onrender.com").replace(/\/$/, "");
const EMPTY_FORM = { title: "", category_id: "", content: "", image_url: "", access_type: "FREE", status: "DRAFT" };
const EMPTY_CATEGORY = { name: "", slug: "" };

function resizeCoverImage(file, width, height, mode) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return reject(new Error("Image editor is unavailable in this browser."));
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      const scale = mode === "cover" ? Math.max(width / image.width, height / image.height) : Math.min(width / image.width, height / image.height);
      const drawWidth = image.width * scale;
      const drawHeight = image.height * scale;
      context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not process this image.")), "image/jpeg", 0.88);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("This image could not be opened."));
    };
    image.src = objectUrl;
  });
}

function App() {
  const [session, setSession] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [email, setEmail] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginMessage, setLoginMessage] = useState("");
  const [categories, setCategories] = useState([]);
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState("articles");
  const [categoryEditorOpen, setCategoryEditorOpen] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState(null);
  const [categoryForm, setCategoryForm] = useState(EMPTY_CATEGORY);
  const [categorySaving, setCategorySaving] = useState(false);
  const [imagePreset, setImagePreset] = useState("1200x675");
  const [imageMode, setImageMode] = useState("cover");
  const [imageUploading, setImageUploading] = useState(false);
  const [imagePreview, setImagePreview] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setCheckingSession(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setCheckingSession(false);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const apiFetch = useCallback(async (path, options = {}) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Your session has expired. Please sign in again.");
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) throw new Error("Authentication failed. Sign out and sign in again.");
      if (response.status === 403) throw new Error("This account does not have active admin access. Check the Supabase profiles role/status.");
      throw new Error(result.error || `Request failed (${response.status})`);
    }
    return result;
  }, []);

  const loadData = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError("");
    try {
      const [categoryResponse, articleResponse] = await Promise.all([
        apiFetch("/api/admin/categories"),
        apiFetch("/api/admin/articles?page=1&limit=100"),
      ]);
      setCategories(categoryResponse.data || []);
      setArticles(articleResponse.data || []);
    } catch (err) {
      setError(err.message || "Unable to load the dashboard.");
    } finally {
      setLoading(false);
    }
  }, [session, apiFetch]);

  useEffect(() => { loadData(); }, [loadData]);

  const counts = useMemo(() => ({
    all: articles.length,
    published: articles.filter((a) => a.status === "PUBLISHED").length,
    drafts: articles.filter((a) => a.status === "DRAFT").length,
    premium: articles.filter((a) => a.access_type === "PREMIUM").length,
  }), [articles]);

  const filteredArticles = useMemo(() => articles.filter((article) => {
    const matchesSearch = `${article.title} ${article.slug}`.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "ALL" || article.status === statusFilter;
    const matchesCategory = categoryFilter === "ALL" || article.category_id === categoryFilter;
    return matchesSearch && matchesStatus && matchesCategory;
  }), [articles, search, statusFilter, categoryFilter]);

  async function sendMagicLink(event) {
    event.preventDefault();
    setLoginBusy(true);
    setLoginMessage("");
    const { error: authError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setLoginBusy(false);
    setLoginMessage(authError ? authError.message : "Sign-in link sent. Open the email on this device to continue.");
  }

  async function signOut() {
    await supabase.auth.signOut();
    setArticles([]);
    setCategories([]);
    setNotice("");
  }

  function openCreate() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, category_id: categories[0]?.id || "" });
    setEditorOpen(true);
    setError("");
    setNotice("");
  }

  function openEdit(article) {
    setEditingId(article.id);
    setForm({
      title: article.title || "",
      category_id: article.category_id || "",
      content: article.content || "",
      image_url: article.image_url || "",
      access_type: article.access_type || "FREE",
      status: article.status || "DRAFT",
    });
    setEditorOpen(true);
    setError("");
    setNotice("");
  }

  function changeForm(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function saveArticle(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payload = { ...form, image_url: form.image_url.trim() || null };
      const result = await apiFetch(
        editingId ? `/api/admin/articles/${editingId}` : "/api/admin/articles",
        { method: editingId ? "PATCH" : "POST", body: JSON.stringify(payload) },
      );
      const saved = result.data;
      setArticles((current) => {
        const next = editingId ? current.map((item) => item.id === saved.id ? saved : item) : [saved, ...current];
        return next.sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
      });
      setEditorOpen(false);
      setNotice(editingId ? "Article updated successfully." : "Article created successfully.");
    } catch (err) {
      setError(err.message || "Unable to save article.");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(article, status) {
    setError("");
    setNotice("");
    try {
      const result = await apiFetch(`/api/admin/articles/${article.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setArticles((current) => current.map((item) => item.id === article.id ? result.data : item));
      setNotice(status === "PUBLISHED" ? "Article published." : status === "UNPUBLISHED" ? "Article unpublished." : "Article moved to draft.");
    } catch (err) {
      setError(err.message || "Unable to change article status.");
    }
  }

  async function deleteArticle(article) {
    if (!window.confirm(`Delete “${article.title}”? This cannot be undone.`)) return;
    setError("");
    setNotice("");
    try {
      await apiFetch(`/api/admin/articles/${article.id}`, { method: "DELETE" });
      setArticles((current) => current.filter((item) => item.id !== article.id));
      setNotice("Article deleted.");
    } catch (err) {
      setError(err.message || "Unable to delete article.");
    }
  }

  function openCreateCategory() {
    setEditingCategoryId(null);
    setCategoryForm(EMPTY_CATEGORY);
    setCategoryEditorOpen(true);
    setError("");
    setNotice("");
  }

  function openEditCategory(category) {
    setEditingCategoryId(category.id);
    setCategoryForm({ name: category.name || "", slug: category.slug || "" });
    setCategoryEditorOpen(true);
    setError("");
    setNotice("");
  }

  async function saveCategory(event) {
    event.preventDefault();
    setCategorySaving(true);
    setError("");
    setNotice("");
    try {
      const result = await apiFetch(
        editingCategoryId ? `/api/admin/categories/${editingCategoryId}` : "/api/admin/categories",
        { method: editingCategoryId ? "PATCH" : "POST", body: JSON.stringify(categoryForm) },
      );
      setCategories((current) => {
        const next = editingCategoryId
          ? current.map((item) => item.id === result.data.id ? result.data : item)
          : [...current, result.data];
        return next.sort((a, b) => a.name.localeCompare(b.name));
      });
      setCategoryEditorOpen(false);
      setNotice(editingCategoryId ? "Category updated." : "Category created.");
    } catch (err) {
      setError(err.message || "Unable to save category.");
    } finally {
      setCategorySaving(false);
    }
  }

  async function deleteCategory(category) {
    if (!window.confirm(`Delete category “${category.name}”? Categories with articles cannot be deleted.`)) return;
    setError("");
    setNotice("");
    try {
      await apiFetch(`/api/admin/categories/${category.id}`, { method: "DELETE" });
      setCategories((current) => current.filter((item) => item.id !== category.id));
      if (categoryFilter === category.id) setCategoryFilter("ALL");
      setNotice("Category deleted.");
    } catch (err) {
      setError(err.message || "Unable to delete category.");
    }
  }

  async function uploadCoverImage(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Choose a JPG, PNG or WebP image.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("The original image must be 10 MB or smaller.");
      return;
    }
    const [width, height] = imagePreset.split("x").map(Number);
    setImageUploading(true);
    setError("");
    setNotice("");
    try {
      const resized = await resizeCoverImage(file, width, height, imageMode);
      const objectPath = `covers/${Date.now()}-${crypto.randomUUID()}.jpg`;
      const { error: uploadError } = await supabase.storage.from("article-images").upload(
        objectPath, resized, { contentType: "image/jpeg", upsert: false, cacheControl: "3600" },
      );
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from("article-images").getPublicUrl(objectPath);
      setForm((current) => ({ ...current, image_url: data.publicUrl }));
      setImagePreview(data.publicUrl);
      setNotice(`Cover image processed to ${width} × ${height} and uploaded.`);
    } catch (err) {
      setError(err.message || "Unable to upload image. Confirm the CMS storage migration has been applied.");
    } finally {
      setImageUploading(false);
    }
  }

  if (checkingSession) return <div className="center-screen"><div className="spinner" /><p>Checking your session…</p></div>;

  if (!session) return (
    <main className="login-screen">
      <section className="login-card">
        <div className="brand-mark">N<span>.</span></div>
        <p className="eyebrow">NEWSROOM CONTROL</p>
        <h1>Welcome back.</h1>
        <p className="muted">Sign in with your authorized admin email to manage INDIA and CRYPTO research.</p>
        <form onSubmit={sendMagicLink} className="login-form">
          <label htmlFor="email">Admin email</label>
          <input id="email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <button className="primary-button full-width" disabled={loginBusy}>{loginBusy ? "Sending link…" : "Email me a sign-in link"} <span>↗</span></button>
        </form>
        {loginMessage && <p className={loginMessage.startsWith("Sign-in") ? "success-message" : "error-message"}>{loginMessage}</p>}
        <p className="login-footnote"><span className="lock-icon">⌑</span> Admin access is verified by the backend. An account without the ADMIN role cannot manage articles.</p>
      </section>
      <div className="login-decoration"><div className="orb orb-one" /><div className="orb orb-two" /><span>Clarity in every story.</span></div>
    </main>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="News admin home"><span className="brand-mark small">N<span>.</span></span><span>newsroom<small>ADMIN CONSOLE</small></span></a>
        <div className="workspace-label">WORKSPACE</div>
        <div className="nav-item active"><span className="nav-icon">▦</span> Articles <span className="nav-count">{articles.length}</span></div>
        <div className="nav-item muted-nav"><span className="nav-icon">◈</span> Categories</div>
        <div className="sidebar-bottom">
          <div className="secure-note"><span>✳</span><div><strong>Secure workspace</strong><small>Role-protected access</small></div></div>
          <div className="user-row"><div className="avatar">{(session.user.email || "A").slice(0, 1).toUpperCase()}</div><div className="user-meta"><strong>{session.user.email}</strong><small>Administrator</small></div><button className="icon-button" onClick={signOut} title="Sign out" aria-label="Sign out">↗</button></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar"><div><span className="breadcrumb">Workspace</span><span className="crumb-divider">/</span><strong>Articles</strong></div><div className="topbar-right"><span className="live-dot" /> API connected <button className="avatar top-avatar">{(session.user.email || "A").slice(0, 1).toUpperCase()}</button></div></header>
        <section className="page-heading">
          <div><p className="eyebrow">CONTENT MANAGEMENT</p><h1>Articles <span className="heading-period">.</span></h1><p className="muted">Create, organize and publish your newsroom content.</p></div>
          <button className="primary-button" onClick={openCreate}>＋ <span>New article</span></button>
        </section>

        <section className="stats-grid">
          <div className="stat-card"><div className="stat-label">Total articles <span>↗</span></div><div className="stat-number">{counts.all}</div><div className="stat-caption">Across all categories</div></div>
          <div className="stat-card"><div className="stat-label">Published <span className="stat-symbol green">●</span></div><div className="stat-number">{counts.published}</div><div className="stat-caption">Visible to readers</div></div>
          <div className="stat-card"><div className="stat-label">Drafts <span className="stat-symbol amber">◷</span></div><div className="stat-number">{counts.drafts}</div><div className="stat-caption">Work in progress</div></div>
          <div className="stat-card"><div className="stat-label">Premium <span className="stat-symbol violet">◆</span></div><div className="stat-number">{counts.premium}</div><div className="stat-caption">Subscriber content</div></div>
        </section>

        {error && <div className="alert error-alert"><strong>Something needs attention</strong><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
        {notice && <div className="alert success-alert"><span>✓</span>{notice}<button onClick={() => setNotice("")} aria-label="Dismiss message">×</button></div>}

        <section className="content-card">
          <div className="table-heading"><div><h2>All articles</h2><p className="muted">Manage drafts and published research.</p></div><button className="secondary-button" onClick={loadData} disabled={loading}>↻ <span>Refresh</span></button></div>
          <div className="filters">
            <label className="search-box"><span>⌕</span><input aria-label="Search articles" placeholder="Search by title or slug…" value={search} onChange={(e) => setSearch(e.target.value)} /><kbd>⌘ K</kbd></label>
            <select aria-label="Filter by category" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}><option value="ALL">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
            <select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="ALL">All statuses</option><option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option><option value="UNPUBLISHED">Unpublished</option></select>
          </div>
          <div className="table-wrap">
            <table><thead><tr><th>ARTICLE</th><th>CATEGORY</th><th>ACCESS</th><th>STATUS</th><th>UPDATED</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {loading ? <tr><td colSpan="6" className="empty-state"><div className="spinner" />Loading articles…</td></tr> :
                  filteredArticles.length === 0 ? <tr><td colSpan="6" className="empty-state"><div className="empty-icon">▤</div><strong>{articles.length ? "No matching articles" : "Your newsroom starts here"}</strong><span>{articles.length ? "Try changing your filters." : "Create your first article to start building the library."}</span>{!articles.length && <button className="secondary-button" onClick={openCreate}>＋ Create first article</button>}</td></tr> :
                  filteredArticles.map((article) => <tr key={article.id}>
                    <td><div className="article-cell">{article.image_url ? <img src={article.image_url} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} /> : <div className="article-placeholder">{(article.title || "N").slice(0,1).toUpperCase()}</div>}<div><strong>{article.title}</strong><small>{article.slug}</small></div></div></td>
                    <td><span className="category-pill">{article.categories?.name || categories.find((c) => c.id === article.category_id)?.name || "Uncategorized"}</span></td>
                    <td><span className={article.access_type === "PREMIUM" ? "access-premium" : "access-free"}>{article.access_type === "PREMIUM" ? "◆ Premium" : "○ Free"}</span></td>
                    <td><span className={`status-pill status-${article.status?.toLowerCase()}`}><i />{article.status?.toLowerCase()}</span></td>
                    <td className="date-cell">{new Date(article.updated_at || article.created_at).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}</td>
                    <td><div className="row-actions"><button className="icon-button" title="Edit article" aria-label={`Edit ${article.title}`} onClick={() => openEdit(article)}>✎</button><button className="icon-button" title={article.status === "PUBLISHED" ? "Unpublish" : "Publish"} aria-label={article.status === "PUBLISHED" ? "Unpublish article" : "Publish article"} onClick={() => changeStatus(article, article.status === "PUBLISHED" ? "UNPUBLISHED" : "PUBLISHED")}>{article.status === "PUBLISHED" ? "Ⅱ" : "↗"}</button><button className="icon-button danger-action" title="Delete article" aria-label={`Delete ${article.title}`} onClick={() => deleteArticle(article)}>⌫</button></div></td>
                  </tr>)
                }
              </tbody>
            </table>
          </div>
          <div className="table-footer"><span>Showing <strong>{filteredArticles.length}</strong> of <strong>{articles.length}</strong> articles</span><span>INDIA <b>·</b> CRYPTO</span></div>
        </section>
        <footer className="page-footer"><span>NEWSROOM ADMIN</span><span>Write with clarity. Publish with confidence.</span></footer>
      </main>

      {editorOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditorOpen(false); }}>
        <section className="editor-modal" role="dialog" aria-modal="true" aria-labelledby="editor-title">
          <div className="modal-header"><div><p className="eyebrow">{editingId ? "CONTENT EDITOR" : "NEW CONTENT"}</p><h2 id="editor-title">{editingId ? "Edit article" : "Create an article"}</h2></div><button className="icon-button close-button" onClick={() => setEditorOpen(false)} aria-label="Close editor">×</button></div>
          <form onSubmit={saveArticle} className="editor-form">
            <label>Article title<input name="title" value={form.title} onChange={changeForm} maxLength="240" placeholder="Write a clear, specific headline" required /></label>
            <div className="form-two-col"><label>Category<select name="category_id" value={form.category_id} onChange={changeForm} required><option value="">Choose category</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Content access<select name="access_type" value={form.access_type} onChange={changeForm}><option value="FREE">Free</option><option value="PREMIUM">Premium</option></select></label></div>
            <label>Cover image URL <span className="optional-label">Optional</span><input type="url" name="image_url" value={form.image_url} onChange={changeForm} placeholder="https://example.com/image.jpg" /></label>
            <label>Article content<textarea name="content" value={form.content} onChange={changeForm} rows="10" placeholder="Write your article or research here…" required /></label>
            <label>Publishing status<select name="status" value={form.status} onChange={changeForm}><option value="DRAFT">Save as draft</option><option value="PUBLISHED">Publish now</option><option value="UNPUBLISHED">Unpublished</option></select></label>
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setEditorOpen(false)}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? "Saving…" : editingId ? "Save changes" : "Create article"}</button></div>
          </form>
        </section>
      </div>}
    </div>
  );
}

export default App;
