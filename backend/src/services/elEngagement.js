const textValue = value => String(value ?? '').replace(/\s+/g,' ').trim()
const finiteNumber = value => Number.isFinite(Number(value)) ? Number(value) : null

function boolValue(value) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  return /^(?:1|true|yes|да)$/i.test(String(value || '').trim())
}

function productOf(row = {}) {
  const nested = row.productDetails || row.product || row.details || {}
  return {
    nmID:row.nmID ?? row.nmId ?? row.nm_id ?? nested.nmID ?? nested.nmId ?? null,
    vendorCode:textValue(row.vendorCode ?? row.supplierArticle ?? row.sa_name ?? nested.vendorCode ?? nested.supplierArticle),
    title:textValue(row.title ?? row.productName ?? row.name ?? nested.productName ?? nested.title ?? nested.name) || 'Товар WB',
  }
}

function ratingOf(row = {}) {
  const value = finiteNumber(row.productValuation ?? row.valuation ?? row.rating)
  return value != null && value >= 0 && value <= 5 ? value : null
}

function answeredOf(row = {}) {
  return boolValue(row.isAnswered) || Boolean(textValue(row.answer?.text ?? row.answerText ?? row.answer))
}

function archivedOf(row = {}) {
  return boolValue(row.archived) || String(row.state || row.status || '').toLowerCase() === 'archived'
}

function compactFeedback(row = {}, rowType = 'review') {
  const product = productOf(row)
  return {
    id:row.id ?? row.feedbackId ?? row.questionId ?? null,
    rowType,
    createdAt:row.createdDate ?? row.createdAt ?? row.updatedDate ?? row.updatedAt ?? null,
    userName:textValue(row.userName ?? row.user_name) || null,
    text:textValue(row.text ?? row.question ?? row.message?.text),
    pros:textValue(row.pros) || null,
    cons:textValue(row.cons) || null,
    answer:textValue(row.answer?.text ?? row.answerText ?? row.answer) || null,
    rating:ratingOf(row),
    isAnswered:answeredOf(row),
    archived:archivedOf(row),
    wasViewed:row.wasViewed == null ? null : boolValue(row.wasViewed),
    ...product,
  }
}

function compactChat(row = {}) {
  return {
    id:row.eventID ?? row.eventId ?? row.chatID ?? row.chatId ?? row.id ?? null,
    rowType:String(row.rowType || (row.eventID || row.eventId ? 'event' : 'chat')),
    createdAt:row.addTimestamp ?? row.createdAt ?? row.createdDate ?? row.timestamp ?? row.date ?? null,
    sender:textValue(row.sender ?? row.senderName ?? row.userName ?? row.clientName ?? row.message?.sender) || null,
    text:textValue(row.text ?? row.message?.text ?? row.message ?? row.lastMessage?.text),
    eventType:textValue(row.eventType ?? row.type ?? row.status) || null,
    chatId:textValue(row.chatID ?? row.chatId ?? row.chat?.id ?? row.clientID ?? row.clientId) || null,
  }
}

function productSignals(reviews = [], questions = []) {
  const byProduct = new Map()
  const keyOf = row => String(row.nmID || row.vendorCode || row.title || 'unknown')
  const add = row => {
    const key = keyOf(row)
    const current = byProduct.get(key) || {
      nmID:row.nmID || null,
      vendorCode:row.vendorCode || '',
      title:row.title || 'Товар WB',
      lowRatedReviews:0,
      unansweredReviews:0,
      unansweredQuestions:0,
      ratings:[],
    }
    if (row.rowType === 'review') {
      if (row.rating != null && row.rating <= 3) current.lowRatedReviews += 1
      if (!row.isAnswered && !row.archived) current.unansweredReviews += 1
      if (row.rating != null) current.ratings.push(row.rating)
    } else if (!row.isAnswered && !row.archived) current.unansweredQuestions += 1
    byProduct.set(key,current)
  }
  reviews.forEach(add)
  questions.forEach(add)
  return [...byProduct.values()].map(item=>({
    ...item,
    averageRating:item.ratings.length ? Math.round(item.ratings.reduce((sum,value)=>sum+value,0)/item.ratings.length*10)/10 : null,
    ratings:undefined,
    attentionScore:item.lowRatedReviews*3 + item.unansweredQuestions*2 + item.unansweredReviews,
  })).filter(item=>item.attentionScore>0).sort((a,b)=>b.attentionScore-a.attentionScore).slice(0,30)
}

export function buildElEngagementData({
  reviews = [], questions = [], chats = [], totals = {}, summaries = {}, period = null, states = {},
} = {}) {
  const reviewRows = (Array.isArray(reviews) ? reviews : []).map(row=>compactFeedback(row,'review'))
  const questionRows = (Array.isArray(questions) ? questions : []).map(row=>compactFeedback(row,'question'))
  const chatRows = (Array.isArray(chats) ? chats : []).map(compactChat)
  const ratings = reviewRows.map(row=>row.rating).filter(value=>value != null)
  const lowRatedReviews = reviewRows.filter(row=>row.rating != null && row.rating <= 3)
    .sort((a,b)=>(a.rating ?? 6)-(b.rating ?? 6) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
  const unansweredReviews = reviewRows.filter(row=>!row.isAnswered && !row.archived)
  const unansweredQuestions = questionRows.filter(row=>!row.isAnswered && !row.archived)
  const reviewTotal = Math.max(Number(totals.reviews || 0),Number(summaries.reviews?.total || 0),reviewRows.length)
  const questionTotal = Math.max(Number(totals.questions || 0),Number(summaries.questions?.total || 0),questionRows.length)
  const chatTotal = Math.max(Number(totals.chats || 0),Number(summaries.chats?.total || 0),chatRows.length)

  return {
    available:reviewTotal + questionTotal + chatTotal > 0,
    period,
    totals:{ reviews:reviewTotal,questions:questionTotal,chats:chatTotal },
    summary:{
      reviews:{
        total:reviewTotal,
        answered:Number(summaries.reviews?.answered ?? reviewRows.filter(row=>row.isAnswered && !row.archived).length),
        unanswered:Number(summaries.reviews?.unanswered ?? unansweredReviews.length),
        archived:Number(summaries.reviews?.archived ?? reviewRows.filter(row=>row.archived).length),
        lowRated:lowRatedReviews.length,
        averageRating:ratings.length ? Math.round(ratings.reduce((sum,value)=>sum+value,0)/ratings.length*10)/10 : null,
        ratingsObserved:ratings.length,
      },
      questions:{
        total:questionTotal,
        answered:Number(summaries.questions?.answered ?? questionRows.filter(row=>row.isAnswered && !row.archived).length),
        unanswered:Number(summaries.questions?.unanswered ?? unansweredQuestions.length),
      },
      chats:{
        total:chatTotal,
        dialogs:Number(summaries.chats?.chatCount ?? chatRows.filter(row=>row.rowType==='chat').length),
        events:Number(summaries.chats?.eventCount ?? chatRows.filter(row=>row.rowType==='event').length),
        readOnly:true,
      },
    },
    reviews:reviewRows.slice(0,120),
    questions:questionRows.slice(0,120),
    chats:chatRows.slice(0,80),
    lowRatedReviews:lowRatedReviews.slice(0,30),
    unansweredReviews:unansweredReviews.slice(0,30),
    unansweredQuestions:unansweredQuestions.slice(0,30),
    productSignals:productSignals(reviewRows,questionRows),
    states,
    warning:reviewTotal + questionTotal + chatTotal > 0
      ? null
      : 'Отзывы, вопросы и чаты пока не синхронизированы с WB. Эл не будет выдумывать мнение покупателей.',
  }
}

export const engagementInternals = Object.freeze({ productOf,ratingOf,answeredOf,archivedOf,compactFeedback,compactChat })
