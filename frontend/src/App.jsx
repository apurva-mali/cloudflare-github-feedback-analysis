import { useState, useEffect, Fragment } from 'react';
import {
  Search, LayoutGrid, BarChart3, ChevronDown, ChevronRight,
  Filter, X, Calendar, AlertCircle, CheckCircle2, Clock,
  TrendingUp, TrendingDown, Copy, Bell, RotateCcw, ExternalLink, MessageSquare, ThumbsUp
} from 'lucide-react';
import cfLogo from './assets/cf-logo-v2.png';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import './App.css';

// Same-origin by default (the Worker serves both the API and this app).
// In `npm run dev`, vite.config.js proxies API routes to `wrangler dev` on :8787.
const API_BASE = import.meta.env.VITE_API_BASE ?? '';

function App() {
  const [activeTab, setActiveTab] = useState('feedback-log');
  const [feedbackData, setFeedbackData] = useState([]);
  const [filteredData, setFilteredData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');


  // Filters
  const [filters, setFilters] = useState({
    source: '',
    timeline: 'all',
    feedbackType: '',
    urgencyLevel: '',
    userType: '',
    productCategory: '',
    region: ''
  });

  // Fetch all feedback data
  useEffect(() => {
    fetchAllFeedback();
  }, []);

  // Apply filters when data or filters change
  useEffect(() => {
    applyFilters();
  }, [feedbackData, filters, searchQuery]);

  const fetchAllFeedback = async () => {
    setLoading(true);
    try {
      // Use the /all endpoint to get all feedback
      const response = await fetch(`${API_BASE}/all`);
      if (!response.ok) throw new Error('Failed to fetch feedback');
      const data = await response.json();

      // Transform data to match our schema
      const transformed = (data.results || []).map(item => ({
        id: item.id,
        timestamp: item.feedback_timestamp || item.created_at || new Date().toISOString(),
        user_id: item.user_id || 'Unknown',
        source: item.source || 'Unknown',
        product_category: item.product_category || 'Unknown',
        user_type: item.user_type || 'Not Available',
        urgency_level: item.urgency_level || 'Neutral',
        feedback_type: item.feedback_type || 'UX',
        region: item.region || 'Unknown',
        summary: item.summary || '',
        recommended_action: item.recommended_action || '',
        status: item.feedback_status || 'Open',
        original_text: item.original_text || item.text || '',
        sentiment_score: item.sentiment_score,
        nps_class: item.nps_class,
        // GitHub provenance (null for manually ingested items)
        title: item.title || null,
        source_url: item.source_url || null,
        repo: item.repo || null,
        labels: Array.isArray(item.labels) ? item.labels : [],
        source_state: item.source_state || null,
        reactions: item.reactions || 0,
        comments_count: item.comments_count || 0
      }));

      setFeedbackData(transformed);
    } catch (error) {
      console.error('Error fetching feedback:', error);
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...feedbackData];

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(item =>
        item.original_text?.toLowerCase().includes(query) ||
        item.summary?.toLowerCase().includes(query) ||
        item.user_id?.toLowerCase().includes(query)
      );
    }

    // Timeline filter
    if (filters.timeline !== 'all') {
      const now = new Date();
      const daysAgo = filters.timeline === 'today' ? 0 :
        filters.timeline === '7d' ? 7 :
          filters.timeline === '30d' ? 30 : 0;
      const cutoffDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
      filtered = filtered.filter(item => {
        const itemDate = new Date(item.timestamp);
        return itemDate >= cutoffDate;
      });
    }

    // Other filters
    if (filters.source) filtered = filtered.filter(item => item.source === filters.source);
    if (filters.feedbackType) filtered = filtered.filter(item => item.feedback_type === filters.feedbackType);
    if (filters.urgencyLevel) filtered = filtered.filter(item => item.urgency_level === filters.urgencyLevel);
    if (filters.userType) filtered = filtered.filter(item => item.user_type === filters.userType);
    if (filters.productCategory) filtered = filtered.filter(item => item.product_category === filters.productCategory);
    if (filters.region) filtered = filtered.filter(item => item.region === filters.region);

    setFilteredData(filtered);
  };

  const toggleRow = (id) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  const updateFilter = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const clearFilter = (key) => {
    setFilters(prev => ({ ...prev, [key]: '' }));
  };

  const resetFilters = () => {
    setFilters({
      source: '',
      timeline: 'all',
      feedbackType: '',
      urgencyLevel: '',
      userType: '',
      productCategory: '',
      region: ''
    });
  };

  // Persist PM workflow status (Open | Ticket Raised | Resolved) in D1.
  // Clicking an active button again puts the item back to Open.
  const toggleStatus = async (id, target) => {
    const current = feedbackData.find(d => d.id === id)?.status;
    const next = current === target ? 'Open' : target;
    const setLocal = (status) =>
      setFeedbackData(prev => prev.map(d => (d.id === id ? { ...d, status } : d)));

    setLocal(next); // optimistic
    try {
      const res = await fetch(`${API_BASE}/feedback/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback_status: next })
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (error) {
      console.error('Failed to update status:', error);
      setLocal(current); // roll back
    }
  };

  // Calculate KPIs
  const calculateKPIs = () => {
    const now = new Date();
    const currentData = filteredData;
    let previousData = [];

    // Determine previous period based on timeline filter
    if (filters.timeline === '7d') {
      const start = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      const end = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      previousData = feedbackData.filter(d => {
        const date = new Date(d.timestamp);
        return date >= start && date < end;
      });
    } else if (filters.timeline === '30d') {
      const start = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
      const end = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      previousData = feedbackData.filter(d => {
        const date = new Date(d.timestamp);
        return date >= start && date < end;
      });
    } else {
      // For 'all' or 'today', we can just use the previous 30 days as a reference point for simplicity
      // or disable trends. Let's compare vs the previous 30 day window for consistency if 'all' is selected.
      const start = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
      const end = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      previousData = feedbackData.filter(d => {
        const date = new Date(d.timestamp);
        return date >= start && date < end;
      });
    }

    // Helper: Calculate Percentage Change
    const getChange = (current, previous) => {
      if (previous === 0) return current === 0 ? 0 : 100;
      return Math.round(((current - previous) / previous) * 100);
    };

    const total = currentData.length;
    const prevTotal = previousData.length;

    // NPS
    const promoters = currentData.filter(d => d.nps_class === 'Promoter').length;
    const detractors = currentData.filter(d => d.nps_class === 'Detractor').length;
    const nps = total > 0 ? ((promoters - detractors) / total) * 100 : 0;

    // Previous NPS (approximate from raw data)
    const prevPromoters = previousData.filter(d => d.nps_class === 'Promoter').length;
    const prevDetractors = previousData.filter(d => d.nps_class === 'Detractor').length;
    const prevNps = prevTotal > 0 ? ((prevPromoters - prevDetractors) / prevTotal) * 100 : 0;
    const npsChange = Math.round(nps - prevNps); // Absolute point change for NPS

    // Sentiment
    const positive = currentData.filter(d => d.sentiment_score >= 7).length;
    const prevPositive = previousData.filter(d => d.sentiment_score >= 7).length;

    const negative = currentData.filter(d => d.sentiment_score <= 4).length;
    const prevNegative = previousData.filter(d => d.sentiment_score <= 4).length;

    const positivePct = total > 0 ? (positive / total) * 100 : 0;
    const negativePct = total > 0 ? (negative / total) * 100 : 0;

    // Critical Ratio (High Urgency)
    const highUrgency = currentData.filter(d => d.urgency_level === 'High').length;
    const criticalRatio = total > 0 ? (highUrgency / total) * 100 : 0;

    // Top Impact Category
    const categoryCounts = {};
    currentData.forEach(d => {
      const cat = d.product_category || 'Unknown';
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });
    const topCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

    return {
      nps: Math.round(nps),
      npsChange,
      total,
      totalChange: getChange(total, prevTotal),
      positivePct: Math.round(positivePct),
      positiveChange: getChange(positive, prevPositive),
      negativePct: Math.round(negativePct),
      negativeChange: getChange(negative, prevNegative),
      criticalRatio: Math.round(criticalRatio),
      topCategory
    };
  };

  const kpis = calculateKPIs();

  // Chart data
  const getFeedbackCountOverTime = () => {
    const grouped = {};
    filteredData.forEach(item => {
      const date = new Date(item.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (!grouped[date]) {
        grouped[date] = { date, positive: 0, neutral: 0, negative: 0 };
      }
      const score = item.sentiment_score || 5;
      if (score >= 7) grouped[date].positive++;
      else if (score <= 4) grouped[date].negative++;
      else grouped[date].neutral++;
    });
    return Object.values(grouped).sort((a, b) => new Date(a.date) - new Date(b.date));
  };

  const getProductDistribution = () => {
    const counts = {};
    filteredData.forEach(item => {
      const cat = item.product_category || 'Unknown';
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  };

  const getRegionDistribution = () => {
    const counts = {};
    filteredData.forEach(item => {
      const region = item.region || 'Unknown';
      counts[region] = (counts[region] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  };

  const getSourceDistribution = () => {
    const grouped = {};
    filteredData.forEach(item => {
      const source = item.source || 'Unknown';
      grouped[source] = (grouped[source] || 0) + 1;
    });
    return Object.entries(grouped).map(([name, value]) => ({ name, value }));
  };

  const getNPSOverTime = () => {
    const grouped = {};
    filteredData.forEach(item => {
      const date = new Date(item.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (!grouped[date]) {
        grouped[date] = { date, promoters: 0, detractors: 0, total: 0 };
      }
      grouped[date].total++;
      if (item.nps_class === 'Promoter') grouped[date].promoters++;
      if (item.nps_class === 'Detractor') grouped[date].detractors++;
    });
    return Object.values(grouped)
      .map(d => ({
        date: d.date,
        nps: d.total > 0 ? Math.round(((d.promoters - d.detractors) / d.total) * 100) : 0
      }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));
  };

  // Get unique filter values
  const uniqueSources = [...new Set(feedbackData.map(d => d.source))].filter(Boolean);
  const uniqueFeedbackTypes = [...new Set(feedbackData.map(d => d.feedback_type))].filter(Boolean);
  const uniqueUrgencyLevels = [...new Set(feedbackData.map(d => d.urgency_level))].filter(Boolean);
  const uniqueUserTypes = [...new Set(feedbackData.map(d => d.user_type))].filter(Boolean);
  const uniqueProductCategories = [...new Set(feedbackData.map(d => d.product_category))].filter(Boolean);
  const uniqueRegions = [...new Set(feedbackData.map(d => d.region))].filter(Boolean);

  const COLORS = {
    orange: '#f48120',
    orangeHover: '#faad3f',
    charcoal: '#404041',
    white: '#ffffff',
    sectionBg: '#f8f9fa',
    border: '#e6e6e6',
    disabled: '#b0b0b0'
  };

  const pieColors = [COLORS.orange, '#94a3b8', '#64748b', '#475569', '#334155'];

  return (
    <div className="app">
      {/* Top Navigation */}
      <nav className="top-nav">
        <div className="nav-content">
          <div className="nav-logo">
            <img src={cfLogo} alt="Cloudflare" className="nav-logo-img" style={{ height: '40px' }} />
            <span className="logo-text">Cloudflare Voice</span>
          </div>
          <div className="nav-right">
            <button className="subscribe-btn">
              <Bell size={16} />
              Subscribe to Alerts
            </button>
            <div className="profile-section">
              <div className="profile-info">
                <span className="profile-name">Product Manager View</span>
                <span className="profile-role">Admin</span>
              </div>
              <div className="profile-avatar">PM</div>
            </div>
          </div>
        </div>
      </nav>

      <div className="dashboard-container">
        {/* Left Sidebar - Filters */}
        <aside className="sidebar">
          <div className="sidebar-header">
            <Filter size={18} />
            <h3>Filters</h3>
          </div>

          <div className="filter-section">
            <label>Timeline</label>
            <select
              value={filters.timeline}
              onChange={(e) => updateFilter('timeline', e.target.value)}
              className="filter-select"
            >
              <option value="today">Today</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="all">All time</option>
            </select>
          </div>

          <div className="filter-section">
            <label>Source</label>
            <select
              value={filters.source}
              onChange={(e) => updateFilter('source', e.target.value)}
              className="filter-select"
            >
              <option value="">All Sources</option>
              {uniqueSources.map(src => (
                <option key={src} value={src}>{src}</option>
              ))}
            </select>
          </div>

          <div className="filter-section">
            <label>Feedback Type</label>
            <select
              value={filters.feedbackType}
              onChange={(e) => updateFilter('feedbackType', e.target.value)}
              className="filter-select"
            >
              <option value="">All Types</option>
              {uniqueFeedbackTypes.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>

          <div className="filter-section">
            <label>Urgency Level</label>
            <select
              value={filters.urgencyLevel}
              onChange={(e) => updateFilter('urgencyLevel', e.target.value)}
              className="filter-select"
            >
              <option value="">All Levels</option>
              {uniqueUrgencyLevels.map(level => (
                <option key={level} value={level}>{level}</option>
              ))}
            </select>
          </div>

          <div className="filter-section">
            <label>User Type</label>
            <select
              value={filters.userType}
              onChange={(e) => updateFilter('userType', e.target.value)}
              className="filter-select"
            >
              <option value="">All Types</option>
              {uniqueUserTypes.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>

          <div className="filter-section">
            <label>Product Category</label>
            <select
              value={filters.productCategory}
              onChange={(e) => updateFilter('productCategory', e.target.value)}
              className="filter-select"
            >
              <option value="">All Categories</option>
              {uniqueProductCategories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          <div className="filter-section">
            <label>Region</label>
            <select
              value={filters.region}
              onChange={(e) => updateFilter('region', e.target.value)}
              className="filter-select"
            >
              <option value="">All Regions</option>
              {uniqueRegions.map(reg => (
                <option key={reg} value={reg}>{reg}</option>
              ))}
            </select>
          </div>

          <button className="reset-filters-btn" onClick={resetFilters}>
            <RotateCcw size={16} />
            Reset Filters
          </button>
        </aside>

        {/* Main Content */}
        <main className="main-content">
          {/* Tabs */}
          <div className="tabs">
            <button
              className={`tab ${activeTab === 'feedback-log' ? 'active' : ''}`}
              onClick={() => setActiveTab('feedback-log')}
            >
              <LayoutGrid size={18} />
              Feedback Log
            </button>
            <button
              className={`tab ${activeTab === 'kpi-dashboard' ? 'active' : ''}`}
              onClick={() => setActiveTab('kpi-dashboard')}
            >
              <BarChart3 size={18} />
              KPI Dashboard
            </button>
            <button
              className={`tab ${activeTab === 'clustered-issues' ? 'active' : ''}`}
              onClick={() => setActiveTab('clustered-issues')}
            >
              <LayoutGrid size={18} />
              Clustered Issues
            </button>
          </div>

          {/* Active Filter Chips */}
          {(filters.source || filters.feedbackType || filters.urgencyLevel ||
            filters.userType || filters.productCategory || filters.region) && (
              <div className="filter-chips">
                {filters.source && (
                  <span className="chip">
                    Source: {filters.source}
                    <X size={14} onClick={() => clearFilter('source')} />
                  </span>
                )}
                {filters.feedbackType && (
                  <span className="chip">
                    Type: {filters.feedbackType}
                    <X size={14} onClick={() => clearFilter('feedbackType')} />
                  </span>
                )}
                {filters.urgencyLevel && (
                  <span className="chip">
                    Urgency: {filters.urgencyLevel}
                    <X size={14} onClick={() => clearFilter('urgencyLevel')} />
                  </span>
                )}
                {filters.userType && (
                  <span className="chip">
                    User: {filters.userType}
                    <X size={14} onClick={() => clearFilter('userType')} />
                  </span>
                )}
                {filters.productCategory && (
                  <span className="chip">
                    Product: {filters.productCategory}
                    <X size={14} onClick={() => clearFilter('productCategory')} />
                  </span>
                )}
                {filters.region && (
                  <span className="chip">
                    Region: {filters.region}
                    <X size={14} onClick={() => clearFilter('region')} />
                  </span>
                )}
              </div>
            )}

          {/* Feedback Log Tab */}
          {activeTab === 'feedback-log' && (
            <div className="tab-content">
              <div className="search-bar-container">
                <div className="search-bar">
                  <Search size={18} />
                  <input
                    type="text"
                    placeholder="Search feedback..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="search-input"
                  />
                </div>
              </div>

              <div className="table-card">
                <table className="feedback-table">
                  <thead>
                    <tr>
                      <th></th>
                      <th>Timestamp</th>
                      <th>User ID</th>
                      <th>Source</th>
                      <th>Product Category</th>
                      <th>User Type</th>
                      <th>Urgency</th>
                      <th>Feedback Type</th>
                      <th>Region</th>
                      <th>Summary</th>
                      <th style={{ width: '100px' }}>Status</th>
                      <th style={{ width: '140px' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan="13" className="loading-cell">Loading feedback...</td>
                      </tr>
                    ) : filteredData.length === 0 ? (
                      <tr>
                        <td colSpan="13" className="empty-cell">No feedback found</td>
                      </tr>
                    ) : (
                      filteredData.map((item) => (
                        <Fragment key={item.id}>
                          <tr
                            className="table-row"
                            onClick={() => toggleRow(item.id)}
                          >
                            <td className="expand-cell">
                              {expandedRows.has(item.id) ? (
                                <ChevronDown size={16} />
                              ) : (
                                <ChevronRight size={16} />
                              )}
                            </td>
                            <td>{new Date(item.timestamp).toLocaleDateString()}</td>
                            <td className={item.user_id === 'Unknown' ? 'unknown' : ''}>
                              {item.user_id}
                            </td>
                            <td>{item.source}</td>
                            <td className={item.product_category === 'Unknown' ? 'unknown' : ''}>
                              {item.product_category}
                            </td>
                            <td>{item.user_type}</td>
                            <td>
                              <span className={`urgency-badge ${item.urgency_level?.toLowerCase()}`}>
                                {item.urgency_level}
                              </span>
                            </td>
                            <td>{item.feedback_type}</td>
                            <td className={item.region === 'Unknown' ? 'unknown' : ''}>
                              {item.region}
                            </td>
                            <td className="summary-cell">{item.summary || '-'}</td>
                            <td>
                              <span className={`status-badge ${item.status?.toLowerCase().replace(/\s+/g, '-')}`}>
                                {item.status}
                              </span>
                            </td>
                            <td>
                              <div className="action-buttons">
                                <button
                                  className={`action-btn resolve ${item.status === 'Resolved' ? 'active' : ''}`}
                                  title="Mark as Resolved"
                                  onClick={(e) => { e.stopPropagation(); toggleStatus(item.id, 'Resolved'); }}
                                >
                                  <CheckCircle2 size={16} />
                                  <span>{item.status === 'Resolved' ? 'Resolved' : 'Resolve'}</span>
                                </button>
                                <button
                                  className={`action-btn ticket ${item.status === 'Ticket Raised' ? 'active' : ''}`}
                                  title="Create Ticket"
                                  onClick={(e) => { e.stopPropagation(); toggleStatus(item.id, 'Ticket Raised'); }}
                                >
                                  <AlertCircle size={16} />
                                  <span>{item.status === 'Ticket Raised' ? 'Ticket Raised' : 'Raise Ticket'}</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                          {expandedRows.has(item.id) && (
                            <tr className="expanded-row">
                              <td colSpan="13">
                                <div className="expanded-content">
                                  {item.source_url && (
                                    <div className="source-meta">
                                      <a
                                        href={item.source_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="source-link"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <ExternalLink size={14} />
                                        {item.repo || (item.source === 'Hacker News' ? 'View on Hacker News' : 'View original')}
                                      </a>
                                      {item.source_state && (
                                        <span className={`upstream-state ${item.source_state}`}>
                                          {item.source_state === 'closed' ? 'Closed on GitHub' : 'Open on GitHub'}
                                        </span>
                                      )}
                                      <span className="meta-stat" title={item.source === 'Hacker News' ? 'Points' : 'Reactions'}>
                                        <ThumbsUp size={14} /> {item.reactions}
                                      </span>
                                      <span className="meta-stat" title="Comments">
                                        <MessageSquare size={14} /> {item.comments_count}
                                      </span>
                                      {item.labels.map(label => (
                                        <span key={label} className="label-chip">{label}</span>
                                      ))}
                                    </div>
                                  )}
                                  <div style={{ marginBottom: '1.5rem' }}>
                                    <h4>{item.title ? item.title : 'Original Feedback'}</h4>
                                    <p className="original-text">{item.original_text}</p>
                                  </div>
                                  <div>
                                    <h4 style={{ color: '#f48120' }}>Recommended Action (AI Generated)</h4>
                                    <p>{item.recommended_action || 'Review this feedback to determine next steps.'}</p>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* KPI Dashboard Tab */}
          {activeTab === 'kpi-dashboard' && (
            <div className="tab-content">
              {/* KPI Strip */}
              <div className="kpi-strip">

                <div className="kpi-card">
                  <div className="kpi-label" title="% positive (sentiment 8-10) minus % negative (1-4), from -100 to +100">Sentiment Index</div>
                  <div style={{ width: '100%', height: '120px', position: 'relative' }}>
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie
                          data={[
                            { value: 33, color: '#ef4444' }, // Red (Detractors)
                            { value: 34, color: '#eab308' }, // Yellow (Passives)
                            { value: 33, color: '#22c55e' }  // Green (Promoters)
                          ]}
                          cx="50%"
                          cy="100%"
                          startAngle={180}
                          endAngle={0}
                          innerRadius={60}
                          outerRadius={80}
                          paddingAngle={0}
                          dataKey="value"
                        >
                          <Cell key="a" fill="#ef4444" stroke="none" />
                          <Cell key="b" fill="#eab308" stroke="none" />
                          <Cell key="c" fill="#22c55e" stroke="none" />
                        </Pie>
                        {/* Needle */}
                        <Pie
                          data={[
                            { value: Math.max(0, kpis.nps + 100), color: 'none' }, // Transparent before needle
                            { value: 4, color: '#333' },                           // The Needle
                            { value: Math.max(0, 200 - (kpis.nps + 100) - 4), color: 'none' } // Transparent after needle
                          ]}
                          cx="50%"
                          cy="100%"
                          startAngle={180}
                          endAngle={0}
                          innerRadius={0}
                          outerRadius={80}
                          dataKey="value"
                          stroke="none"
                        >
                          <Cell key="a" fill="none" />
                          <Cell key="b" fill="#333" />
                          <Cell key="c" fill="none" />
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{
                      position: 'absolute',
                      bottom: '0',
                      width: '100%',
                      textAlign: 'center',
                      fontSize: '1.5rem',
                      fontWeight: 'bold',
                      color: kpis.nps > 30 ? '#16a34a' : kpis.nps < 0 ? '#dc2626' : '#ca8a04'
                    }}>
                      {kpis.nps}
                    </div>
                  </div>
                  <div className="kpi-comparison" style={{ marginTop: '0.5rem', justifyContent: 'center' }}>
                    {kpis.npsChange >= 0 ? (
                      <TrendingUp size={14} className="trend-up" />
                    ) : (
                      <TrendingDown size={14} className="trend-down" />
                    )}
                    {Math.abs(kpis.npsChange)} pts vs prev
                  </div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">Positive Feedback</div>
                  <div className="kpi-value">{kpis.positivePct}%</div>
                  <div className="kpi-comparison">
                    {kpis.positiveChange >= 0 ? (
                      <TrendingUp size={14} className="trend-up" />
                    ) : (
                      <TrendingDown size={14} className="trend-down" />
                    )}
                    {Math.abs(kpis.positiveChange)}% vs prev
                  </div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">Critical Ratio</div>
                  <div className="kpi-value">{kpis.criticalRatio}%</div>
                  <div className="kpi-comparison">
                    High Urgency Volume
                  </div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">Top Impact Area</div>
                  <div className="kpi-value" style={{ fontSize: '1.5rem', marginTop: '0.5rem' }}>{kpis.topCategory}</div>
                  <div className="kpi-comparison">
                    Most Reported
                  </div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">Total Volume</div>
                  <div className="kpi-value">{kpis.total}</div>
                  <div className="kpi-comparison">
                    {kpis.totalChange >= 0 ? (
                      <TrendingUp size={14} className="trend-up" />
                    ) : (
                      <TrendingDown size={14} className="trend-down" />
                    )}
                    {Math.abs(kpis.totalChange)}% vs prev
                  </div>
                </div>
              </div>

              {/* Analytics Section */}
              {/* Analytics Section */}
              <div className="analytics-section">
                <div className="chart-card">
                  <h3>Feedback Count Over Time</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={getFeedbackCountOverTime()}>
                      <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                      <XAxis dataKey="date" stroke={COLORS.charcoal} />
                      <YAxis stroke={COLORS.charcoal} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="positive" stackId="a" fill={COLORS.orange} />
                      <Bar dataKey="neutral" stackId="a" fill="#cbd5e1" />
                      <Bar dataKey="negative" stackId="a" fill="#64748b" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="chart-card">
                  <h3>Sentiment Heatmap (Last 30 Days)</h3>
                  <div className="heatmap-grid">
                    {Array.from({ length: 30 }).map((_, i) => {
                      const d = new Date();
                      d.setDate(d.getDate() - (29 - i));
                      const dateStr = d.toISOString().split('T')[0];
                      const dayData = filteredData.filter(item => item.timestamp.startsWith(dateStr));
                      const avgSentiment = dayData.length
                        ? dayData.reduce((acc, curr) => acc + (curr.sentiment_score || 5), 0) / dayData.length
                        : null;

                      let bgClass = 'empty';
                      if (avgSentiment !== null) {
                        if (avgSentiment >= 7) bgClass = 'positive';
                        else if (avgSentiment <= 4) bgClass = 'negative';
                        else bgClass = 'neutral';
                      }

                      return (
                        <div
                          key={i}
                          className={`heatmap-cell ${bgClass}`}
                          title={`${dateStr}: ${avgSentiment ? avgSentiment.toFixed(1) : 'No data'}`}
                        />
                      );
                    })}
                  </div>
                  <div className="heatmap-legend">
                    <span>Low</span>
                    <div className="heatmap-scale"></div>
                    <span>High</span>
                  </div>
                </div>

                <div className="chart-card">
                  <h3>Product-wise Feedback Distribution</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={getProductDistribution()}>
                      <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                      <XAxis dataKey="name" stroke={COLORS.charcoal} />
                      <YAxis stroke={COLORS.charcoal} />
                      <Tooltip />
                      <Bar dataKey="value" fill={COLORS.orange} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="chart-card">
                  <h3>Source Distribution</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={getSourceDistribution()}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        outerRadius={100}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {getSourceDistribution().map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={pieColors[index % pieColors.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="chart-card">
                  <h3>Sentiment Index Over Time</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={getNPSOverTime()}>
                      <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                      <XAxis dataKey="date" stroke={COLORS.charcoal} />
                      <YAxis stroke={COLORS.charcoal} />
                      <Tooltip />
                      <Line type="monotone" dataKey="nps" stroke={COLORS.orange} strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="chart-card">
                  <h3>Feedbacks per Region</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={getRegionDistribution()} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                      <XAxis type="number" stroke={COLORS.charcoal} />
                      <YAxis dataKey="name" type="category" width={100} stroke={COLORS.charcoal} />
                      <Tooltip />
                      <Bar dataKey="value" fill="#8884d8" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Trend Analysis Summary */}
              <div className="trend-summary-card">
                <div className="trend-summary-header">
                  <h3>Trend Analysis Summary</h3>
                  <button className="copy-btn" title="Copy to clipboard">
                    <Copy size={16} />
                  </button>
                </div>
                <p>
                  Based on the current data, feedback volume shows {kpis.total > 0 ? 'active' : 'limited'} engagement
                  across {getProductDistribution().length} product categories. The sentiment index of {kpis.nps} indicates
                  {kpis.nps > 0 ? ' positive' : ' negative'} sentiment overall. Key areas requiring attention include
                  {getProductDistribution().slice(0, 2).map(p => ` ${p.name}`).join(' and')}.
                </p>
              </div>
            </div>
          )}

          {/* Clustered Issues Tab */}
          {activeTab === 'clustered-issues' && (
            <div className="tab-content">
              <div className="clusters-grid">
                {Object.entries(
                  filteredData.reduce((acc, item) => {
                    const cat = item.product_category || 'Unknown';
                    if (!acc[cat]) acc[cat] = [];
                    acc[cat].push(item);
                    return acc;
                  }, {})
                ).map(([category, items]) => (
                  <div key={category} className="cluster-card">
                    <div className="cluster-header">
                      <h3>{category}</h3>
                      <span className="cluster-count">{items.length} issues</span>
                    </div>
                    <div className="cluster-items">
                      {/* Group by Rec. Action for sub-clusters */}
                      {Object.entries(
                        items.reduce((subAcc, item) => {
                          const action = item.recommended_action || 'General Feedback';
                          if (!subAcc[action]) subAcc[action] = 0;
                          subAcc[action]++;
                          return subAcc;
                        }, {})
                      ).slice(0, 5).map(([action, count]) => (
                        <div key={action} className="cluster-item">
                          <div className="cluster-item-title">{action}</div>
                          <div className="cluster-item-count">{count} reports</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
