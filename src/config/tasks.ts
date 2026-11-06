// Задания выезда (из концепции). Рейтинг за них идёт вне игрового лимита.
// check: auto — засчитывается само; moderation — проверяют модераторы; host — отмечает ведущий;
// qr — по QR-коду; code — кодовое слово.
export type TaskCheck = 'auto' | 'moderation' | 'host' | 'qr' | 'code';
export type TaskForm = 'text' | 'photo' | 'text+photo' | 'link' | 'link+photo' | 'profile' | 'quiz' | 'reflection' | 'thought' | 'invite' | 'channel';

export interface TaskDef {
  id: string;
  when: string;
  day: 'before' | 'nov7' | 'nov8' | 'both' | 'creative';
  title: string;
  check: TaskCheck;
  how: string;
  rating: string;          // как в таблице: «20», «до 80», «+50»
  amount: number;          // сколько начислять за одно выполнение
  limit: 'once' | 'daily' | number; // once — один раз; daily — раз в день; число — столько раз всего
  form?: TaskForm;
  hint?: string;           // подсказка в форме сдачи
  minText?: number;        // для текстовых форм: от скольких символов
  maxText?: number;        // и до скольких
}

export const TASKS: TaskDef[] = [
  // С запуска, до 8 ноября включительно
  { id: 'profile', when: 'С запуска', day: 'before', title: 'Заполнить профиль: институт, курс, фото, 3 факта о себе', check: 'auto', how: 'Авто', rating: '20', amount: 20, limit: 'once', form: 'profile' },
  { id: 'tg_channel', when: 'С запуска', day: 'before', title: 'Подписаться на Telegram-канал ППО', check: 'auto', how: 'Бот сам проверяет подписку; без Telegram — скриншот на проверку', rating: '20', amount: 20, limit: 'once', form: 'channel' },
  { id: 'vk_group', when: 'С запуска', day: 'before', title: 'Вступить в группу ППО во ВКонтакте', check: 'moderation', how: 'Скриншот на модерацию', rating: '20', amount: 20, limit: 'once', form: 'photo', hint: 'Скриншот, где видно, что ты в группе' },
  { id: 'intro_quiz', when: 'С запуска', day: 'before', title: 'Квиз «Что ты знаешь о профсоюзе», 10 вопросов', check: 'auto', how: 'Авто, 5 за верный ответ', rating: 'до 50', amount: 5, limit: 'once', form: 'quiz' },
  { id: 'daily_login', when: 'Каждый день', day: 'before', title: 'Зайти в игру', check: 'auto', how: 'Авто', rating: '10 в день', amount: 10, limit: 'daily' },
  { id: 'story', when: 'До 8 ноября', day: 'before', title: 'Сторис или пост «Я на выезде»', check: 'moderation', how: 'Ссылка или скрин на модерацию', rating: '30', amount: 30, limit: 'once', form: 'link+photo', hint: 'Ссылка на пост или скриншот сторис' },
  // 7 ноября
  { id: 'bingo', when: '11:00 Знакомка', day: 'nov7', title: 'Бинго знакомств: карточка 3×3 «найди того, кто…»', check: 'qr', how: 'Скан QR нужного человека; линия — 40, вся карточка — 80', rating: 'до 80', amount: 40, limit: 2 },
  { id: 'grant', when: '11:30 Гранты', day: 'nov7', title: 'Особый заказ «Грантодатель»: идея проекта — проблема, решение, бюджет', check: 'moderation', how: 'Текст на модерацию', rating: '50', amount: 50, limit: 'once', form: 'text', hint: 'Проблема → решение → бюджет. 3–6 предложений' },
  { id: 'grant_best', when: '11:30 Гранты', day: 'nov7', title: 'Лучшая идея блока', check: 'host', how: 'Отмечает ведущий', rating: '+50', amount: 50, limit: 'once' },
  { id: 'speech', when: '12:00 Публички', day: 'nov7', title: 'Выступить', check: 'host', how: 'Отмечает ведущий', rating: '40', amount: 40, limit: 'once' },
  { id: 'speech_best', when: '12:00 Публички', day: 'nov7', title: 'Лучший спикер блока', check: 'host', how: 'Отмечает ведущий', rating: '+60', amount: 60, limit: 'once' },
  { id: 'duel', when: '14:00 Управленческие поединки', day: 'nov7', title: 'Выиграть поединок', check: 'host', how: 'Отмечает судья', rating: '30 за победу', amount: 30, limit: 5 },
  { id: 'team', when: '15:00 Команда в профбюро', day: 'nov7', title: 'Команда-победитель', check: 'host', how: 'Ведущий отмечает команду целиком', rating: '50 каждому', amount: 50, limit: 'once' },
  { id: 'brand', when: '16:40 Личный бренд', day: 'nov7', title: 'Особый заказ «Пиарщик»: обновить аватар и описание в соцсети', check: 'moderation', how: 'Скрин на модерацию', rating: '30', amount: 30, limit: 'once', form: 'photo', hint: 'Скриншот профиля после обновления' },
  { id: 'party_game', when: '20:00 Вечерка', day: 'nov7', title: 'Победить в игре «Объясни»', check: 'host', how: 'Отмечает ведущий', rating: '30', amount: 30, limit: 2 },
  { id: 'party_contest', when: '20:00 Вечерка', day: 'nov7', title: 'Победить в конкурсе вечерки', check: 'host', how: 'Отмечает ведущий', rating: '30', amount: 30, limit: 3 },
  // 8 ноября
  { id: 'sponsor', when: '10:00 Спонсоры', day: 'nov8', title: 'Особый заказ «Спонсор»: питч за 60 секунд или письмо-предложение', check: 'moderation', how: 'Ведущий или текст на модерацию', rating: '50', amount: 50, limit: 'once', form: 'text', hint: 'Письмо спонсору: кто вы, что предлагаете, что получит спонсор' },
  { id: 'sponsor_best', when: '10:00 Спонсоры', day: 'nov8', title: 'Лучший питч', check: 'host', how: 'Отмечает ведущий', rating: '+50', amount: 50, limit: 'once' },
  { id: 'reflection', when: '11:00 Рефлексия', day: 'nov8', title: 'Заполнить форму рефлексии в приложении', check: 'auto', how: 'Авто при отправке', rating: '40', amount: 40, limit: 'once', form: 'reflection' },
  { id: 'press', when: '11:00 Бренд ППО', day: 'nov8', title: 'Особый заказ «Редактор»: пост о выезде для соцсетей', check: 'moderation', how: 'Текст и фото на модерацию; публикация на странице ППО — ещё +50', rating: '50', amount: 50, limit: 'once', form: 'text+photo', hint: 'Текст поста и одно фото с выезда' },
  // Сквозные
  { id: 'lecture', when: 'На каждом блоке', day: 'both', title: 'Отметиться на блоке: подойди к организатору и отсканируй QR', check: 'qr', how: 'QR на телефоне организатора или на экране; меняется каждые 20 секунд, под ним — код', rating: '15 за блок', amount: 15, limit: 30 },
  { id: 'speed_qr', when: 'Каждый день', day: 'both', title: '«Я — скорость»: найти спрятанный QR дня', check: 'qr', how: 'Организаторы прячут QR на базе; баллы — только первым пяти', rating: '30', amount: 30, limit: 'daily' },
  { id: 'thought', when: 'После блока', day: 'both', title: 'Мысль с блока: особый заказ «Конспект»', check: 'auto', how: 'От 80 символов, до конца дня блока', rating: '20', amount: 20, limit: 8, form: 'thought' },
  { id: 'egg', when: 'На блоках', day: 'both', title: 'Пасхалка в презентации', check: 'code', how: 'Кодовое слово из презентации или со сцены. Некоторые слова живут недолго или только для первых', rating: '15', amount: 15, limit: 50 },
  { id: 'egg_gold', when: 'Раз в день', day: 'both', title: 'Золотая пасхалка', check: 'code', how: 'Кодовое слово', rating: '50', amount: 50, limit: 'daily' },
  { id: 'docs_quiz', when: 'После образовалки', day: 'both', title: 'Квиз по документам', check: 'auto', how: 'Авто, 3 вопроса', rating: 'до 30', amount: 10, limit: 'daily', form: 'quiz' },
  { id: 'case_day', when: 'Каждый день', day: 'both', title: '«Дело дня» — правовая ситуация', check: 'auto', how: 'Авто, раздел «Правовуха»', rating: '20', amount: 20, limit: 'daily' },
  { id: 'meet', when: 'Весь выезд', day: 'both', title: 'Знакомство: отсканировать личный QR нового человека', check: 'qr', how: 'Раз на пару, до 20 в день. QR обновляется — скрин не сработает', rating: '5, из другого ПБ — 10', amount: 5, limit: 'daily' },
  { id: 'caches', when: 'Весь выезд', day: 'both', title: 'Тайники: 10 QR спрятаны на базе', check: 'qr', how: 'Авто', rating: '15, за все 10 — ещё +50', amount: 15, limit: 10 },
  { id: 'cache_gold', when: 'Весь выезд', day: 'both', title: 'Золотой тайник — один на всех', check: 'qr', how: 'Только первому', rating: '100', amount: 100, limit: 'once' },
  { id: 'help', when: 'Весь выезд', day: 'both', title: 'Помочь организаторам: дежурство, перенос техники', check: 'host', how: 'Отмечает организатор, до 3 раз', rating: '20', amount: 20, limit: 3 },
  { id: 'photo', when: 'Раз в день', day: 'both', title: 'Фото дня для медиа ППО', check: 'moderation', how: 'Фото на модерацию', rating: '20', amount: 20, limit: 'daily', form: 'photo', hint: 'Лучшее фото дня с выезда' },
  // Творческие задания (конкурсы СКС «Ты — лидер»), до 8 ноября включительно — проверяют организаторы
  { id: 'likes', when: 'Каждый день', day: 'creative', title: 'Пролайкать все новые посты ППО во ВКонтакте и в Telegram', check: 'moderation', how: 'Скриншоты лайков и реакций за день', rating: '10 в день', amount: 10, limit: 'daily', form: 'photo', hint: 'Скриншот (можно коллаж): лайки под всеми постами дня в группе ВК и реакции в канале TG' },
  { id: 'vk_comments', when: 'Каждый день', day: 'creative', title: 'Коммент, лайк, подписка: осмысленный комментарий под постом ППО во ВКонтакте', check: 'moderation', how: 'Скриншот комментария', rating: '10 в день', amount: 10, limit: 'daily', form: 'photo', hint: 'Скриншот твоего комментария под постом группы ППО' },
  { id: 'meme', when: 'Каждый день', day: 'creative', title: 'Мемный конкурс: мем про профсоюз или выезд в комментарии канала выезда', check: 'moderation', how: 'Скриншот мема в комментариях канала выезда', rating: '20 в день', amount: 20, limit: 'daily', form: 'photo', hint: 'Скриншот мема в комментариях канала выезда' },
  { id: 'history', when: 'Каждый день', day: 'creative', title: 'Исторический конкурс: сторис во ВКонтакте об исторической дате или герое', check: 'moderation', how: 'Скриншот сторис', rating: '20 в день', amount: 20, limit: 'daily', form: 'link+photo', hint: 'Скриншот сторис ВК (ссылка — если есть)' },
  { id: 'letter', when: 'Весь выезд', day: 'creative', title: 'Искренний лидер: рукописное письмо (другу, наставнику, себе через год)', check: 'moderation', how: 'Фото письма', rating: '30', amount: 30, limit: 'once', form: 'photo', hint: 'Фото рукописного письма' },
  { id: 'new_contest', when: 'Весь выезд', day: 'creative', title: 'Новый конкурс: придумай формат конкурса для студактива', check: 'moderation', how: 'Текст 200–2000 символов', rating: '30', amount: 30, limit: 'once', form: 'text', hint: 'Название, суть, правила, как оценивать, почему это интересно', minText: 200, maxText: 2000 },
  { id: 'new_merch', when: 'Весь выезд', day: 'creative', title: 'Новый мерч: дизайн мерча ППО', check: 'moderation', how: 'Картинка или фото эскиза', rating: '30', amount: 30, limit: 'once', form: 'photo', hint: 'Макет или фото эскиза мерча' },
  { id: 'stickers', when: 'Весь выезд', day: 'creative', title: 'Стикерпак про ППО или выезд', check: 'moderation', how: 'Ссылка на стикерпак', rating: '40', amount: 40, limit: 'once', form: 'link', hint: 'Ссылка t.me/addstickers/…' },
  { id: 'fashion', when: 'Весь выезд', day: 'creative', title: 'Самый модный: пост во ВКонтакте об образе с мерчем ППО', check: 'moderation', how: 'Ссылка на пост', rating: '30', amount: 30, limit: 'once', form: 'link', hint: 'Ссылка на пост ВК' },
  { id: 'edit', when: 'Весь выезд', day: 'creative', title: '«Не мешайте, мы в эдите»: клип о выезде от 30 секунд', check: 'moderation', how: 'Ссылка на видео', rating: '50', amount: 50, limit: 'once', form: 'link', hint: 'Ссылка на клип (ВК, TG, Диск), не короче 30 секунд' },
  { id: 'photohunt', when: 'Весь выезд', day: 'creative', title: 'Фотоохота: коллаж с 4+ организаторами', check: 'moderation', how: 'Фото-коллаж', rating: '30', amount: 30, limit: 'once', form: 'photo', hint: 'Коллаж: ты с каждым из 4+ организаторов' },
  { id: 'cheese', when: 'Весь выезд', day: 'creative', title: '«Сыыыр»: фото всего своего ПБ на выезде', check: 'moderation', how: 'Фото, где всё ПБ в сборе', rating: '30', amount: 30, limit: 'once', form: 'photo', hint: 'Все участники твоего ПБ в одном кадре' },
  { id: 'lightning', when: 'До 8 ноября', day: 'creative', title: '«Живая молния»: выстройтесь всем ПБ в форме молнии ШПА и сфотографируйтесь', check: 'moderation', how: 'Фото на модерацию; молнию должно быть видно', rating: '40', amount: 40, limit: 'once', form: 'photo', hint: 'Фото, где ваше ПБ выстроилось молнией' },
  { id: 'breakfast', when: '7 и 8 ноября', day: 'creative', title: 'Завтрак с новым знакомым: селфи за завтраком с участником из другого ПБ', check: 'moderation', how: 'Фото на модерацию, раз в день', rating: '20 в день', amount: 20, limit: 'daily', form: 'photo', hint: 'Селфи за завтраком: ты и человек из другого профбюро' },
  { id: 'interview', when: 'До 8 ноября', day: 'creative', title: 'Интервью с организатором: как он пришёл в профсоюз и что ему это дало', check: 'moderation', how: 'Текст: имя организатора и 3 факта из разговора', rating: '30', amount: 30, limit: 'once', form: 'text', hint: 'Кого спросил и три самых интересных факта', minText: 120, maxText: 1500 },
  { id: 'warmup', when: 'До 8 ноября', day: 'creative', title: 'Активный перерыв: проведи разминку для 5+ человек между блоками', check: 'moderation', how: 'Фото или кадр из видео разминки', rating: '30', amount: 30, limit: 'once', form: 'photo', hint: 'Кадр, где видно тебя и 5+ участников разминки' },
  { id: 'color_date', when: 'Весь выезд', day: 'creative', title: 'Цветное свидание: коллаж из 10 жёлтых и 10 синих предметов', check: 'moderation', how: 'Фото-коллаж', rating: '30', amount: 30, limit: 'once', form: 'photo', hint: 'Коллаж: 10 жёлтых и 10 синих предметов' },
];

export const DAY_TITLES: Record<TaskDef['day'], string> = {
  before: 'С запуска — до 8 ноября',
  nov7: '7 ноября — на выезде',
  nov8: '8 ноября — на выезде',
  both: 'Сквозные — оба дня',
  creative: 'Творческие — до 8 ноября включительно',
};

export const taskById = (id: string) => TASKS.find((t) => t.id === id);
